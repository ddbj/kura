import { readFileSync } from "node:fs"
import { fileURLToPath, URL } from "node:url"

import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import type { Plugin } from "vite"
import { defineConfig } from "vite"

const appDir = fileURLToPath(new URL("./app", import.meta.url))
const envDevPath = fileURLToPath(new URL("./env.dev", import.meta.url))

// Values without which the SPA cannot reach Keycloak or S3. The file TTL is
// deliberately absent: empty means "no TTL".
const REQUIRED_BUILD_ENV = [
  "VITE_KURA_OIDC_ISSUER",
  "VITE_KURA_OIDC_CLIENT_ID",
  "VITE_KURA_S3_ENDPOINT",
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

// The env files are named env.<environment> because docker compose reads them
// with --env-file, so vite's own .env loader never sees them. Republish
// env.dev's KURA_* as VITE_KURA_* before vite loads its env — the same shape
// the container build gets from compose. An existing value wins, so a shell
// override still works.
//
// Gated on KURA_DEV (set by `npm run dev`) rather than `apply: "serve"`:
// `react-router build` resolves this config with command "serve" internally,
// so apply cannot tell a dev server from a build. Without the gate a
// production build would silently bake env.dev's values instead of failing.
const devEnvFromEnvDev = (): Plugin => ({
  name: "kura-dev-env",
  config: () => {
    if (process.env["KURA_DEV"] !== "1") return
    for (const [key, value] of Object.entries(parseEnvFile(envDevPath))) {
      if (key.startsWith("KURA_")) process.env[`VITE_${key}`] ??= value
    }
  },
})

// Deployment config is baked into the bundle,
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
  },
})

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), devEnvFromEnvDev(), requireBuildEnv()],
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
