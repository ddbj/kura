// Health probes run before any test: fail fast if the dev compose stack or
// staging Keycloak is unreachable. Also fixes KURA_E2E_RUN_ID for the whole
// run so cleanup helpers scope their key space.
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"

import type { FullConfig } from "@playwright/test"

const probe = async (label: string, url: string, check: (res: Response) => Promise<void> | void) => {
  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    throw new Error(`globalSetup: ${label} (${url}) unreachable`, { cause: err })
  }
  if (!res.ok) {
    throw new Error(`globalSetup: ${label} (${url}) returned ${res.status}`)
  }
  await check(res)
}

// The SPA's config is baked in at build time, so there is nothing to fetch
// from the running stack: read the issuer from the env file the dev build was
// made with.
const issuerFromEnvDev = (): string => {
  const line = readFileSync(new URL("../../env.dev", import.meta.url), "utf8")
    .split("\n")
    .find((l) => l.startsWith("KURA_OIDC_ISSUER="))
  const issuer = line?.slice("KURA_OIDC_ISSUER=".length).trim() ?? ""
  if (issuer === "") {
    throw new Error("globalSetup: KURA_OIDC_ISSUER not found in env.dev")
  }

  return issuer
}

const globalSetup = async (config: FullConfig): Promise<void> => {
  const baseURL = config.projects[0]?.use.baseURL ?? process.env["KURA_E2E_BASE_URL"] ?? "http://localhost:28080"
  process.env["KURA_E2E_BASE_URL"] ??= baseURL

  await probe("SPA delivery", baseURL, (res) => {
    const ctype = res.headers.get("content-type") ?? ""
    if (!ctype.includes("text/html")) {
      throw new Error(`globalSetup: ${baseURL} content-type: ${ctype}`)
    }
  })

  const oidcIssuer = process.env["KURA_E2E_OIDC_ISSUER"] ?? issuerFromEnvDev()
  process.env["KURA_E2E_OIDC_ISSUER"] ??= oidcIssuer

  await probe(
    "openid-configuration",
    `${oidcIssuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
    () => undefined,
  )

  process.env["KURA_E2E_RUN_ID"] ??= randomBytes(8).toString("hex")
  process.env["KURA_E2E_S3_ENDPOINT"] ??= "http://localhost:28333"
}

export default globalSetup
