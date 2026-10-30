import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"

import { renewExpiredSession } from "~/lib/auth"

import { encodeTestJwt } from "../../_helpers/oidc"
import { testConfig } from "../../_helpers/render"
import { server } from "../../mocks/server"

const ISSUER = testConfig.oidcIssuer
const TOKEN_ENDPOINT = `${ISSUER}/protocol/openid-connect/token`
const STORAGE_KEY = `oidc.user:${ISSUER}:${testConfig.oidcClientId}`

const nowSeconds = () => Math.floor(Date.now() / 1000)

const seedUser = ({ expiresIn, refreshToken }: { expiresIn: number; refreshToken?: string }) => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    access_token: encodeTestJwt({ preferred_username: "kura-tester", exp: nowSeconds() + expiresIn }),
    token_type: "Bearer",
    scope: "openid",
    profile: { sub: "test-sub", preferred_username: "kura-tester" },
    expires_at: nowSeconds() + expiresIn,
    ...refreshToken === undefined ? {} : { refresh_token: refreshToken },
  }))
}

const storedUser = (): { access_token: string; refresh_token?: string; expires_at: number } | null => {
  const raw = window.sessionStorage.getItem(STORAGE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

// Keycloak's discovery document and token endpoint, the external boundary of
// the refresh-token grant. Records the grant requests it receives.
const seedKeycloak = (token: () => Response) => {
  const grants: URLSearchParams[] = []
  server.use(
    http.get(`${ISSUER}/.well-known/openid-configuration`, () => HttpResponse.json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
      token_endpoint: TOKEN_ENDPOINT,
      end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
      jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
    })),
    http.post(TOKEN_ENDPOINT, async ({ request }) => {
      grants.push(new URLSearchParams(await request.text()))
      return token()
    }),
  )
  return { grants }
}

describe("renewExpiredSession", () => {
  it("expiredUser_withRefreshToken_isRenewedBeforeTheAppReadsIt", async () => {
    seedUser({ expiresIn: -60, refreshToken: "old-refresh" })
    const renewed = encodeTestJwt({ preferred_username: "kura-tester", exp: nowSeconds() + 300 })
    const { grants } = seedKeycloak(() => HttpResponse.json({
      access_token: renewed,
      token_type: "Bearer",
      expires_in: 300,
      refresh_token: "new-refresh",
      scope: "openid",
    }))

    await renewExpiredSession(testConfig)

    expect(grants.map((g) => [g.get("grant_type"), g.get("refresh_token")])).toEqual([["refresh_token", "old-refresh"]])
    expect(storedUser()?.access_token).toBe(renewed)
    expect(storedUser()?.refresh_token).toBe("new-refresh")
    expect(storedUser()?.expires_at).toBeGreaterThan(nowSeconds())
  })

  // The SSO session ended: the login screen has to show, not an error.
  it("expiredUser_refreshRejected_isRemoved", async () => {
    seedUser({ expiresIn: -60, refreshToken: "dead-refresh" })
    seedKeycloak(() => HttpResponse.json(
      { error: "invalid_grant", error_description: "Session not active" },
      { status: 400 },
    ))

    await renewExpiredSession(testConfig)

    expect(storedUser()).toBeNull()
  })

  it("expiredUser_keycloakUnreachable_isRemoved", async () => {
    seedUser({ expiresIn: -60, refreshToken: "old-refresh" })
    seedKeycloak(() => HttpResponse.error())

    await renewExpiredSession(testConfig)

    expect(storedUser()).toBeNull()
  })

  it("liveUser_isLeftAlone", async () => {
    seedUser({ expiresIn: 240, refreshToken: "old-refresh" })
    const { grants } = seedKeycloak(() => HttpResponse.json({}, { status: 500 }))

    await renewExpiredSession(testConfig)

    expect(grants).toHaveLength(0)
    expect(storedUser()?.refresh_token).toBe("old-refresh")
  })

  it("expiredUser_withoutRefreshToken_isLeftForTheLoginScreen", async () => {
    seedUser({ expiresIn: -60 })
    const { grants } = seedKeycloak(() => HttpResponse.json({}, { status: 500 }))

    await renewExpiredSession(testConfig)

    expect(grants).toHaveLength(0)
    expect(storedUser()).not.toBeNull()
  })

  it("noStoredUser_sendsNothing", async () => {
    const { grants } = seedKeycloak(() => HttpResponse.json({}, { status: 500 }))

    await renewExpiredSession(testConfig)

    expect(grants).toHaveLength(0)
    expect(storedUser()).toBeNull()
  })
})
