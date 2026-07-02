import { readFileSync } from "node:fs"
import { fileURLToPath, URL } from "node:url"

import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import type { Plugin } from "vite"
import { defineConfig } from "vite"

const appDir = fileURLToPath(new URL("./app", import.meta.url))
const envDevPath = fileURLToPath(new URL("./env.dev", import.meta.url))

const parseEnvFile = (path: string): Record<string, string> =>
  Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => {
        const eq = line.indexOf("=")
        return [line.slice(0, eq), line.slice(eq + 1)]
      }),
  )

// Serves /_config.json in dev from env.dev, the same variables nginx bakes
// into /_config.json in deployment (docs/architecture.md).
const devConfigJson = (): Plugin => ({
  name: "kura-dev-config-json",
  configureServer: (server) => {
    server.middlewares.use("/_config.json", (_req, res) => {
      const env = parseEnvFile(envDevPath)
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({
        oidcIssuer: env["KURA_OIDC_ISSUER"],
        oidcClientId: env["KURA_OIDC_CLIENT_ID"],
        s3Endpoint: env["KURA_S3_ENDPOINT"],
        publicBase: env["KURA_PUBLIC_BASE_URL"],
        fileTtlDays: env["KURA_FILE_TTL_DAYS"] ?? "",
      }))
    })
  },
})

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), devConfigJson()],
  resolve: {
    alias: { "~": appDir },
  },
  server: {
    // The registered OIDC redirect URIs are origin-specific, so the dev
    // server must own this exact port.
    port: 8080,
    strictPort: true,
  },
  build: {
    // Reserved "_"-prefixed path: cannot collide with the /<user>/<path>
    // public-delivery namespace (docs/architecture.md).
    assetsDir: "_assets",
  },
})
