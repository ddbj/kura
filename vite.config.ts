import { readFileSync } from "node:fs"
import { fileURLToPath, URL } from "node:url"

import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import type { Plugin } from "vite"
import { defineConfig } from "vite"

import { crawlFiles, isHttpOrigin, parseNoindex } from "./app/lib/crawl.ts"

const appDir = fileURLToPath(new URL("./app", import.meta.url))
const envDevPath = fileURLToPath(new URL("./env.dev", import.meta.url))

// Deployment settings the SPA embeds in the bundle. The same names are used
// by the stack itself as KURA_*; only these are republished under the VITE_
// prefix, so an unrelated KURA_* (a secret, a port) can never reach the
// bundle.
const BUILD_ENV = [
  "KURA_OIDC_ISSUER",
  "KURA_OIDC_CLIENT_ID",
  "KURA_S3_ENDPOINT",
  "KURA_FILE_TTL_DAYS",
  "KURA_QUOTA_DEFAULT_MB",
  "KURA_UI_ORIGIN",
  "KURA_NOINDEX",
] as const

// Values without which the SPA cannot reach Keycloak or S3, or robots.txt and
// sitemap.xml cannot write an absolute URL. The file TTL, the quota default
// and noindex are deliberately absent: each has a meaningful fallback (no TTL
// / the specified 1 TB / listed in search engines).
const REQUIRED_BUILD_ENV = [
  "VITE_KURA_OIDC_ISSUER",
  "VITE_KURA_OIDC_CLIENT_ID",
  "VITE_KURA_S3_ENDPOINT",
  "VITE_KURA_UI_ORIGIN",
] as const

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

// The stack names its settings KURA_*; vite only exposes VITE_* to the bundle.
// Doing the rename here rather than in each caller means a build only has to
// supply the KURA_* it already uses for the stack, and the list of what gets
// embedded lives in exactly one place. An explicit VITE_KURA_* wins.
const publishBuildEnv = (): Plugin => ({
  name: "kura-build-env",
  config: () => {
    for (const key of BUILD_ENV) {
      const value = process.env[key]
      if (value !== undefined) process.env[`VITE_${key}`] ??= value
    }
  },
})

// The env files are named env.<environment> because docker compose reads them
// with --env-file, so vite's own .env loader never sees them. Load env.dev so
// `npm run dev` needs no further setup; publishBuildEnv then renames them.
//
// Gated on KURA_DEV (set by `npm run dev`) rather than `apply: "serve"`:
// `react-router build` resolves this config with command "serve" internally,
// so apply cannot tell a dev server from a build. Without the gate a
// production build would silently embed env.dev's values instead of failing.
const devEnvFromEnvDev = (): Plugin => ({
  name: "kura-dev-env",
  config: () => {
    if (process.env["KURA_DEV"] !== "1") return
    for (const [key, value] of Object.entries(parseEnvFile(envDevPath))) {
      if (key.startsWith("KURA_")) process.env[key] ??= value
    }
  },
})

// Deployment config is embedded in the bundle,
// so a missing value would only show up as a broken deployment. Fail here.
// buildStart, not config: `react-router typegen` resolves the config with
// command "build" too, and it has no reason to need deployment values.
const requireBuildEnv = (): Plugin => ({
  name: "kura-require-build-env",
  apply: "build",
  buildStart: () => {
    const missing = REQUIRED_BUILD_ENV.filter((key) => (process.env[key] ?? "") === "")
    if (missing.length > 0) {
      throw new Error(`kura build: missing required env: ${missing.join(", ")}`)
    }
    const uiOrigin = process.env["VITE_KURA_UI_ORIGIN"] ?? ""
    if (!isHttpOrigin(uiOrigin)) {
      throw new Error(`kura build: KURA_UI_ORIGIN must be an http(s) origin without a trailing slash, got ${JSON.stringify(uiOrigin)}`)
    }
    parseNoindex(process.env["VITE_KURA_NOINDEX"])
  },
})

// robots.txt, sitemap.xml and llms.txt (app/lib/crawl.ts), written into the
// client build next to the bundle. react-router also runs an ssr build to
// prerender index.html; its output is discarded, so it emits nothing.
const emitCrawlFiles = (): Plugin => ({
  name: "kura-crawl-files",
  apply: "build",
  generateBundle() {
    if (this.environment.name !== "client") return
    const files = crawlFiles({
      uiOrigin: process.env["VITE_KURA_UI_ORIGIN"] ?? "",
      noindex: parseNoindex(process.env["VITE_KURA_NOINDEX"]),
      s3Endpoint: process.env["VITE_KURA_S3_ENDPOINT"] ?? "",
      oidcIssuer: process.env["VITE_KURA_OIDC_ISSUER"] ?? "",
      oidcClientId: process.env["VITE_KURA_OIDC_CLIENT_ID"] ?? "",
    })
    for (const [fileName, source] of Object.entries(files)) {
      this.emitFile({ type: "asset", fileName, source })
    }
  },
})

export default defineConfig({
  // devEnvFromEnvDev fills in KURA_* from env.dev before publishBuildEnv
  // renames them, so the dev plugin has to run first.
  plugins: [tailwindcss(), reactRouter(), devEnvFromEnvDev(), publishBuildEnv(), requireBuildEnv(), emitCrawlFiles()],
  resolve: {
    alias: { "~": appDir },
  },
  server: {
    // The registered OIDC redirect URIs are origin-specific, so the dev
    // server must own this exact port.
    port: 8080,
    strictPort: true,
  },
})
