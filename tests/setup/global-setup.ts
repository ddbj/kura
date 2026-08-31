import { execFileSync } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { exportJWK, exportPKCS8, generateKeyPair } from "jose"
import type { TestProject } from "vitest/node"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const readEnvFile = (path: string): Record<string, string> => {
  const entries = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=")

      return [line.slice(0, idx), line.slice(idx + 1)] as const
    })

  return Object.fromEntries(entries)
}

const compose = (args: string[], env: NodeJS.ProcessEnv) => {
  execFileSync(
    "docker",
    ["compose", "-p", "kura-test", "--env-file", "env.test", "-f", "compose.yml", "-f", "compose.test.yml", ...args],
    { cwd: repoRoot, env, stdio: "inherit" },
  )
}

const setup = async (project: TestProject) => {
  const testEnv = readEnvFile(join(repoRoot, "env.test"))

  // The web service bind-mounts build/ (SPA build output) and refuses to
  // start without an index.html, but the suite must run before a build
  // exists. Create the directory (so docker does not make a root-owned one)
  // and drop in a placeholder when there is no real build.
  mkdirSync(join(repoRoot, "build", "client"), { recursive: true })
  const indexHtml = join(repoRoot, "build", "client", "index.html")
  if (!existsSync(indexHtml)) {
    writeFileSync(indexHtml, "<!doctype html>\n<title>kura</title>\n")
  }

  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true })
  const jwk = { ...(await exportJWK(publicKey)), kid: "kura-test", alg: "RS256", use: "sig" }
  const jwksDir = join(repoRoot, "tests", "setup", ".jwks")
  mkdirSync(jwksDir, { recursive: true })
  writeFileSync(join(jwksDir, "jwks.json"), JSON.stringify({ keys: [jwk] }))
  // Regenerated per run; kept on disk (gitignored) so ad-hoc scripts can sign
  // tokens against a stack left running with KURA_TEST_KEEP=1.
  writeFileSync(join(jwksDir, "private.pem"), await exportPKCS8(privateKey))

  const adminSub = randomUUID()
  const secrets = {
    KURA_STS_SIGNING_KEY: randomBytes(32).toString("base64"),
    KURA_ROOT_ACCESS_KEY: `root-${randomBytes(8).toString("hex")}`,
    KURA_ROOT_SECRET_KEY: randomBytes(24).toString("base64"),
    KURA_FILER_JWT_KEY: randomBytes(32).toString("base64"),
    KURA_ADMIN_SUBS: adminSub,
  }
  const env = { ...process.env, ...secrets }

  compose(["up", "-d", "--wait"], env)

  project.provide("jwtPrivateKeyPem", await exportPKCS8(privateKey))
  project.provide("adminSub", adminSub)
  project.provide("oidcIssuer", testEnv["KURA_OIDC_ISSUER"]!)
  project.provide("oidcClientId", testEnv["KURA_OIDC_CLIENT_ID"]!)
  project.provide("s3Endpoint", `http://localhost:${testEnv["KURA_S3_PORT"]}`)
  project.provide("spaBase", `http://localhost:${testEnv["KURA_HTTP_PORT"]}`)
  project.provide("rootAccessKey", secrets.KURA_ROOT_ACCESS_KEY)
  project.provide("rootSecretKey", secrets.KURA_ROOT_SECRET_KEY)

  return () => {
    // KURA_TEST_KEEP=1 leaves the stack running for post-mortem debugging.
    if (process.env["KURA_TEST_KEEP"] !== "1") {
      compose(["down", "-v"], env)
    }
  }
}

export default setup

declare module "vitest" {
  export interface ProvidedContext {
    jwtPrivateKeyPem: string
    adminSub: string
    oidcIssuer: string
    oidcClientId: string
    s3Endpoint: string
    spaBase: string
    rootAccessKey: string
    rootSecretKey: string
  }
}
