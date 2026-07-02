import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { decodeJwtPayload, usernameFromAccessToken } from "~/lib/auth/token"

const b64url = (data: string): string => {
  const bytes = new TextEncoder().encode(data)
  let bin = ""
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

const encodeJwt = (payload: unknown): string =>
  `${b64url(JSON.stringify({ alg: "RS256" }))}.${b64url(JSON.stringify(payload))}.sig`

describe("decodeJwtPayload properties", () => {
  test.prop([fc.jsonValue()])(
    "decodeJwtPayload_encodedJsonPayload_roundTrips",
    (value) => {
      // JSON round-trip semantics (-0 becomes 0 etc.) are part of the contract.
      expect(decodeJwtPayload(encodeJwt(value))).toEqual(JSON.parse(JSON.stringify(value)))
    },
  )

  test.prop([fc.string({ minLength: 1 }), fc.string()])(
    "usernameFromAccessToken_anyUnicodeUsername_isExtracted",
    (username, extra) => {
      const jwt = encodeJwt({ preferred_username: username, aud: extra, sub: extra })
      expect(usernameFromAccessToken(jwt)).toBe(username)
    },
  )
})
