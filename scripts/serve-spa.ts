// SPA delivery: serves the static build in
// build/client and nothing else.
//
// vite's preview server is started programmatically with configFile: false:
// vite.config.ts imports the build plugins, which are devDependencies and are
// not installed in the runtime image. vite is the only npm package this needs.
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

import type { Plugin } from "vite"
import { preview } from "vite"

import { CRAWL_FILES } from "../app/lib/crawl.ts"

const outDir = resolve(process.cwd(), "build/client")

// vite always accepts localhost and bare IPs; any other Host — the name the
// reverse proxy in front forwards — must be listed or the request is rejected.
const allowedHosts = (process.env["KURA_ALLOWED_HOSTS"] ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter((host) => host !== "")

// appType "spa" rewrites every unmatched path to index.html, which is what
// makes /browse/* and /auth/callback resolve on a direct hit. Build assets
// must be exempt: a browser holding a cached index.html from before a
// redeploy asks for asset names that no longer exist, and answering those
// with 200 text/html turns a missing file into a confusing MIME error. The
// crawler files are exempt for the same reason: a deployment kept out of
// search engines has no sitemap.xml, and a crawler must not read index.html
// as one.
const crawlPaths: readonly string[] = CRAWL_FILES.map((name) => `/${name}`)

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
      if (!pathname.startsWith("/assets/") && !crawlPaths.includes(pathname)) return next()
      // A ".." inside an asset path is never a real asset name. Answering 404
      // without resolving it keeps this middleware out of path arithmetic and
      // still avoids the SPA fallback replying to an asset request with HTML.
      if (!pathname.includes("..") && existsSync(join(outDir, pathname.slice(1)))) return next()
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
    // Only SeaweedFS answers CORS.
    cors: false,
    allowedHosts,
  },
})

server.printUrls()
