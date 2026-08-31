// SPA delivery (docs/architecture.md「SPA の配信」): serves the static build in
// build/client and nothing else.
//
// vite's preview server is started programmatically with configFile: false so
// no build plugin is loaded — vite is then the only npm package this needs at
// runtime — and so vite never bundles a config file, which it would write to
// node_modules/.vite-temp and fail on the read-only bind mount.
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

import type { Plugin } from "vite"
import { preview } from "vite"

const outDir = resolve(process.cwd(), "build/client")

// vite always accepts localhost and bare IPs; any other Host — the name the
// DDBJ gateway forwards — must be listed or the request is rejected.
const allowedHosts = (process.env["KURA_ALLOWED_HOSTS"] ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter((host) => host !== "")

// appType "spa" rewrites every unmatched path to index.html, which is what
// makes /browse/* and /auth/callback resolve on a direct hit. Build assets
// must be exempt: a browser holding a cached index.html from before a
// redeploy asks for asset names that no longer exist, and answering those
// with 200 text/html turns a missing file into a confusing MIME error.
const assetNotFound = (): Plugin => ({
  name: "kura-asset-404",
  configurePreviewServer: (server) => {
    server.middlewares.use((req, res, next) => {
      const raw = (req.url ?? "").split("?")[0] ?? ""
      let pathname: string
      try {
        pathname = decodeURIComponent(raw)
      } catch {
        return next()
      }
      // ".." falls through to vite's own static handler, which is confined to
      // outDir; this middleware never resolves such a path itself.
      if (!pathname.startsWith("/assets/") || pathname.includes("..")) return next()
      if (existsSync(join(outDir, pathname.slice(1)))) return next()
      res.statusCode = 404
      res.setHeader("Content-Type", "text/plain")
      res.end("Not Found\n")
    })
  },
})

// Without this the failure mode is every request answering with vite's own
// "outDir not found" page rather than anything actionable.
if (!existsSync(join(outDir, "index.html"))) {
  throw new Error("serve-spa: build/client/index.html not found; build the SPA before starting the stack")
}

const server = await preview({
  configFile: false,
  appType: "spa",
  build: { outDir },
  plugins: [assetNotFound()],
  preview: {
    host: true,
    port: 8080,
    strictPort: true,
    // Only SeaweedFS answers CORS (docs/architecture.md CORS).
    cors: false,
    allowedHosts,
  },
})

server.printUrls()
