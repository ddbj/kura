import { describe, expect, test } from "vitest"

import { decodeJwtPayload, subFromAccessToken, usernameFromAccessToken } from "~/lib/auth/token"

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

describe("subFromAccessToken", () => {
  test("subFromAccessToken_tokenWithSub_returnsSub", () => {
    const token = encodeTestJwt({ sub: "0f8fad5b-d9cb-469f-a165-70867728950e", preferred_username: "a_b" })

    expect(subFromAccessToken(token)).toBe("0f8fad5b-d9cb-469f-a165-70867728950e")
  })

  test("subFromAccessToken_missingClaim_throws", () => {
    expect(() => subFromAccessToken(encodeTestJwt({ preferred_username: "x" }))).toThrow()
  })

  test("subFromAccessToken_emptySub_throws", () => {
    expect(() => subFromAccessToken(encodeTestJwt({ sub: "" }))).toThrow()
  })

  test("subFromAccessToken_nonStringSub_throws", () => {
    expect(() => subFromAccessToken(encodeTestJwt({ sub: 42 }))).toThrow()
  })
})
