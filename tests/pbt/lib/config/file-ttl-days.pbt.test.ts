import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { AppConfigSchema } from "~/lib/config"

const base = {
  oidcIssuer: "https://idp.example.org/realms/master",
  oidcClientId: "kura-dev",
  s3Endpoint: "http://localhost:28333",
  publicBase: "http://localhost:28080",
}

const parseTtl = (value: string) => AppConfigSchema.safeParse({ ...base, fileTtlDays: value })

describe("AppConfigSchema.fileTtlDays properties", () => {
  test.prop([fc.integer({ min: 1, max: 1_000_000 })])(
    "fileTtlDays_positiveIntegerString_roundTrips",
    (days) => {
      const result = parseTtl(String(days))
      expect(result.success).toBe(true)
      expect(result.data?.fileTtlDays).toBe(days)
    },
  )

  // 受理集合は「空文字 (= TTL 無効)」と「先頭 0 なしの 10 進正整数」だけ
  test.prop([fc.string()])("fileTtlDays_anyString_acceptedIffEmptyOrPositiveInt", (value) => {
    const result = parseTtl(value)
    expect(result.success).toBe(value === "" || /^[1-9][0-9]*$/.test(value))
  })
})
