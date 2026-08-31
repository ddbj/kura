import { describe, expect, test } from "vitest"

import { AppConfigSchema, readConfig } from "~/lib/config"

const validConfig = {
  oidcIssuer: "https://idp-staging.ddbj.nig.ac.jp/realms/master",
  oidcClientId: "kura-dev",
  s3Endpoint: "http://localhost:28333",
}

const validEnv = {
  VITE_KURA_OIDC_ISSUER: validConfig.oidcIssuer,
  VITE_KURA_OIDC_CLIENT_ID: validConfig.oidcClientId,
  VITE_KURA_S3_ENDPOINT: validConfig.s3Endpoint,
  VITE_KURA_FILE_TTL_DAYS: "",
}

describe("AppConfigSchema", () => {
  test("AppConfigSchema_validConfig_parses", () => {
    expect(AppConfigSchema.parse(validConfig)).toEqual({ ...validConfig, fileTtlDays: null })
  })

  test("AppConfigSchema_fileTtlDaysEmpty_normalizesToNull", () => {
    expect(AppConfigSchema.parse({ ...validConfig, fileTtlDays: "" }).fileTtlDays).toBeNull()
  })

  test("AppConfigSchema_fileTtlDaysNumeric_parsesToInt", () => {
    expect(AppConfigSchema.parse({ ...validConfig, fileTtlDays: "30" }).fileTtlDays).toBe(30)
  })

  test.each(["0", "-1", "abc", "1.5", " 30", "30 ", "０３", "1e3"])(
    "AppConfigSchema_fileTtlDaysInvalid_%s_rejects",
    (value) => {
      expect(() => AppConfigSchema.parse({ ...validConfig, fileTtlDays: value })).toThrow()
    },
  )

  test.each(Object.keys(validConfig))("AppConfigSchema_missing_%s_rejects", (key) => {
    const { [key as keyof typeof validConfig]: _, ...rest } = validConfig
    expect(() => AppConfigSchema.parse(rest)).toThrow()
  })

  test.each([
    ["oidcIssuer", "not a url"],
    ["oidcIssuer", ""],
    ["oidcClientId", ""],
    ["s3Endpoint", "://bad"],
  ])("AppConfigSchema_invalid_%s_rejects", (key, value) => {
    expect(() => AppConfigSchema.parse({ ...validConfig, [key]: value })).toThrow()
  })

  test("AppConfigSchema_nonObjectBody_rejects", () => {
    expect(() => AppConfigSchema.parse("kura")).toThrow()
    expect(() => AppConfigSchema.parse(null)).toThrow()
  })
})

describe("readConfig", () => {
  test("readConfig_validEnv_returnsParsedConfig", () => {
    expect(readConfig(validEnv)).toEqual({ ...validConfig, fileTtlDays: null })
  })

  test("readConfig_ttlSet_parsesToInt", () => {
    expect(readConfig({ ...validEnv, VITE_KURA_FILE_TTL_DAYS: "30" }).fileTtlDays).toBe(30)
  })

  // A build that did not receive the value bakes in `undefined`, which must
  // fail loudly rather than produce a half-configured SPA.
  test.each(["VITE_KURA_OIDC_ISSUER", "VITE_KURA_OIDC_CLIENT_ID", "VITE_KURA_S3_ENDPOINT"])(
    "readConfig_missing_%s_throws",
    (key) => {
      const { [key as keyof typeof validEnv]: _, ...rest } = validEnv
      expect(() => readConfig(rest)).toThrow()
    },
  )

  // Absent and empty are the same thing for the TTL: no TTL.
  test("readConfig_ttlAbsent_isNull", () => {
    const { VITE_KURA_FILE_TTL_DAYS: _, ...rest } = validEnv
    expect(readConfig(rest).fileTtlDays).toBeNull()
  })
})
