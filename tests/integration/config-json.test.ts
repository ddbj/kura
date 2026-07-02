import { describe, expect, inject, it } from "vitest"

// nginx bakes /_config.json from env vars (docs/architecture.md frontend).
// The exact key set and string-valued TTL here are what AppConfigSchema
// (app/lib/config) expects; schema-side parsing is covered by unit tests.
describe("/_config.json", () => {
  it("serves the env-derived config JSON", async () => {
    const res = await fetch(`${inject("publicBase")}/_config.json`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/json")

    expect(await res.json()).toEqual({
      oidcIssuer: inject("oidcIssuer"),
      oidcClientId: inject("oidcClientId"),
      s3Endpoint: inject("s3Endpoint"),
      publicBase: inject("publicBase"),
      // env.test sets KURA_FILE_TTL_DAYS=30 to cover the TTL-enabled shape
      fileTtlDays: "30",
    })
  })
})
