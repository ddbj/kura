import { z } from "zod"

const base64UrlDecode = (segment: string): string => {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/")
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

// Claims are decoded without signature verification: the frontend only uses
// them for display and bucket-name derivation, authorization is enforced by
// SeaweedFS (docs/architecture.md).
export const decodeJwtPayload = (jwt: string): unknown => {
  const segments = jwt.split(".")
  const payload = segments[1]
  if (segments.length !== 3 || payload === undefined) {
    throw new Error("Malformed JWT")
  }
  return JSON.parse(base64UrlDecode(payload))
}

const accessTokenClaims = z.object({ preferred_username: z.string().min(1) })

export const usernameFromAccessToken = (accessToken: string): string =>
  accessTokenClaims.parse(decodeJwtPayload(accessToken)).preferred_username
