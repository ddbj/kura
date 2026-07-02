import { describe, expect, test } from "vitest"

import { decodeJwtPayload, usernameFromAccessToken } from "~/lib/auth/token"

import { encodeTestJwt } from "../../_helpers/oidc"

describe("decodeJwtPayload", () => {
  test("decodeJwtPayload_unicodePayload_decodes", () => {
    expect(decodeJwtPayload(encodeTestJwt({ name: "すえちゃろ🗄️" }))).toEqual({ name: "すえちゃろ🗄️" })
  })

  test.each([
    ["empty string", ""],
    ["no dots", "abc"],
    ["two segments", "abc.def"],
    ["payload not base64url json", "aGVhZGVy.!!!.sig"],
  ])("decodeJwtPayload_%s_throws", (_label, jwt) => {
    expect(() => decodeJwtPayload(jwt)).toThrow()
  })
})

describe("usernameFromAccessToken", () => {
  test("usernameFromAccessToken_missingClaim_throws", () => {
    expect(() => usernameFromAccessToken(encodeTestJwt({ sub: "x" }))).toThrow()
  })

  test("usernameFromAccessToken_emptyUsername_throws", () => {
    expect(() => usernameFromAccessToken(encodeTestJwt({ preferred_username: "" }))).toThrow()
  })

  test("usernameFromAccessToken_nonStringUsername_throws", () => {
    expect(() => usernameFromAccessToken(encodeTestJwt({ preferred_username: 42 }))).toThrow()
  })
})
