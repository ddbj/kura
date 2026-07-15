// Health probes run before any test: fail fast if the dev compose stack or
// staging Keycloak is unreachable. Also fixes KURA_E2E_RUN_ID for the whole
// run so cleanup helpers scope their key space.
import { randomBytes } from "node:crypto"

import type { FullConfig } from "@playwright/test"

const CONFIG_KEYS = ["oidcIssuer", "oidcClientId", "s3Endpoint", "publicBase", "fileTtlDays"] as const

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

const globalSetup = async (config: FullConfig): Promise<void> => {
  const baseURL = config.projects[0]?.use.baseURL ?? process.env["KURA_E2E_BASE_URL"] ?? "http://localhost:28080"
  process.env["KURA_E2E_BASE_URL"] ??= baseURL

  await probe("healthz", `${baseURL}/healthz`, async (res) => {
    const body = await res.text()
    if (body !== "ok\n") {
      throw new Error(`globalSetup: /healthz body mismatch: ${JSON.stringify(body)}`)
    }
  })

  let oidcIssuer = ""
  await probe("_config.json", `${baseURL}/_config.json`, async (res) => {
    const ctype = res.headers.get("content-type") ?? ""
    if (!ctype.includes("application/json")) {
      throw new Error(`globalSetup: /_config.json content-type: ${ctype}`)
    }
    const body = (await res.json()) as Record<string, unknown>
    for (const key of CONFIG_KEYS) {
      if (typeof body[key] !== "string") {
        throw new Error(`globalSetup: /_config.json missing string key ${key}: got ${JSON.stringify(body[key])}`)
      }
    }
    oidcIssuer = body["oidcIssuer"] as string
    if (oidcIssuer === "") {
      throw new Error("globalSetup: /_config.json oidcIssuer is empty")
    }
  })
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
