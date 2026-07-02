import type { AppConfig } from "~/lib/config"

const b64url = (data: string): string => {
  const bytes = new TextEncoder().encode(data)
  let bin = ""
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// Unsigned test JWT: kura's frontend only decodes claims for display; signature
// verification is SeaweedFS's job (docs/architecture.md).
export const encodeTestJwt = (payload: unknown): string =>
  `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.test-signature`

// Seed the storage key oidc-client-ts reads (storage is the external boundary;
// the real AuthProvider then restores the session itself).
export const seedAuthenticatedUser = (config: AppConfig, { username = "kura-tester" } = {}): string => {
  const accessToken = encodeTestJwt({
    preferred_username: username,
    aud: config.oidcClientId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
  const user = {
    access_token: accessToken,
    token_type: "Bearer",
    scope: "openid",
    profile: { sub: "test-sub", preferred_username: username },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }
  window.sessionStorage.setItem(
    `oidc.user:${config.oidcIssuer}:${config.oidcClientId}`,
    JSON.stringify(user),
  )
  return accessToken
}
