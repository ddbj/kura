import { z } from "zod"

const base64UrlDecode = (segment: string): string => {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/")
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

// Claims are decoded without signature verification: the frontend only uses
// them for display and to name the user's bucket, authorization is enforced
// by SeaweedFS.
export const decodeJwtPayload = (jwt: string): unknown => {
  const segments = jwt.split(".")
  const payload = segments[1]
  if (segments.length !== 3 || payload === undefined) {
    throw new Error("Malformed JWT")
  }
  return JSON.parse(base64UrlDecode(payload))
}

const usernameClaim = z.object({ preferred_username: z.string().min(1) })
const subClaim = z.object({ sub: z.string().min(1) })

// Shown in the UI. It plays no part in authorization.
export const usernameFromAccessToken = (accessToken: string): string =>
  usernameClaim.parse(decodeJwtPayload(accessToken)).preferred_username

// The user's bucket is named after sub, the one claim the user policy reads.
export const subFromAccessToken = (accessToken: string): string =>
  subClaim.parse(decodeJwtPayload(accessToken)).sub
