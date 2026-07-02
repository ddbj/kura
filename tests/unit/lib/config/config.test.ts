import { http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import { AppConfigSchema, fetchConfig } from "~/lib/config"

import { server } from "../../mocks/server"

const validConfig = {
  oidcIssuer: "https://idp-staging.ddbj.nig.ac.jp/realms/master",
  oidcClientId: "kura-dev",
  s3Endpoint: "http://localhost:28333",
  publicBase: "http://localhost:28080",
}

describe("AppConfigSchema", () => {
  test("AppConfigSchema_validConfig_parses", () => {
    expect(AppConfigSchema.parse(validConfig)).toEqual(validConfig)
  })

  test.each(Object.keys(validConfig))("AppConfigSchema_missing_%s_rejects", (key) => {
    const { [key as keyof typeof validConfig]: _, ...rest } = validConfig
    expect(() => AppConfigSchema.parse(rest)).toThrow()
  })

  test.each([
    ["oidcIssuer", "not a url"],
    ["oidcIssuer", ""],
    ["oidcClientId", ""],
    ["s3Endpoint", "://bad"],
    ["publicBase", "localhost:28080"],
  ])("AppConfigSchema_invalid_%s_rejects", (key, value) => {
    expect(() => AppConfigSchema.parse({ ...validConfig, [key]: value })).toThrow()
  })

  test("AppConfigSchema_nonObjectBody_rejects", () => {
    expect(() => AppConfigSchema.parse("kura")).toThrow()
    expect(() => AppConfigSchema.parse(null)).toThrow()
  })
})

describe("fetchConfig", () => {
  test("fetchConfig_ok_returnsParsedConfig", async () => {
    server.use(http.get("/_config.json", () => HttpResponse.json(validConfig)))
    await expect(fetchConfig()).resolves.toEqual(validConfig)
  })

  test("fetchConfig_httpError_throws", async () => {
    server.use(http.get("/_config.json", () => new HttpResponse(null, { status: 404 })))
    await expect(fetchConfig()).rejects.toThrow(/404/)
  })

  test("fetchConfig_invalidBody_throws", async () => {
    server.use(http.get("/_config.json", () => HttpResponse.json({ oidcClientId: "kura-dev" })))
    await expect(fetchConfig()).rejects.toThrow()
  })
})
