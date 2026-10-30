import type { AuthContextProps } from "react-oidc-context"
import { describe, expect, test, vi } from "vitest"

import { freshAccessToken } from "~/lib/s3/use-s3"

const fakeAuth = ({ expiresIn, renewedToken = "renewed-token" }: {
  expiresIn: number | undefined
  renewedToken?: string
}): AuthContextProps =>
  ({
    user: expiresIn === undefined ? null : { access_token: "stale-token", expires_in: expiresIn },
    signinSilent: vi.fn().mockResolvedValue({ access_token: renewedToken }),
  }) as unknown as AuthContextProps

// STS only checks the access token when it is called; the session it returns
// does not end with the token. The token just has to survive the round trip.
describe("freshAccessToken", () => {
  test("remainingWellOverThreshold_reusesExistingToken", async () => {
    const auth = fakeAuth({ expiresIn: 300 })
    await expect(freshAccessToken(auth)).resolves.toBe("stale-token")
    expect(auth.signinSilent).not.toHaveBeenCalled()
  })

  test("remainingJustOverThreshold_reusesExistingToken", async () => {
    const auth = fakeAuth({ expiresIn: 31 })
    await expect(freshAccessToken(auth)).resolves.toBe("stale-token")
    expect(auth.signinSilent).not.toHaveBeenCalled()
  })

  test("remainingAtThreshold_renews", async () => {
    const auth = fakeAuth({ expiresIn: 30 })
    await expect(freshAccessToken(auth)).resolves.toBe("renewed-token")
    expect(auth.signinSilent).toHaveBeenCalledOnce()
  })

  test("noUser_renews", async () => {
    const auth = fakeAuth({ expiresIn: undefined })
    await expect(freshAccessToken(auth)).resolves.toBe("renewed-token")
    expect(auth.signinSilent).toHaveBeenCalledOnce()
  })

  test("silentRenewReturnsNull_throws", async () => {
    const auth = { user: null, signinSilent: vi.fn().mockResolvedValue(null) } as unknown as AuthContextProps
    await expect(freshAccessToken(auth)).rejects.toThrow()
  })

  test("concurrentCallsNeedingRenewal_shareOneSigninSilentCall", async () => {
    const auth = fakeAuth({ expiresIn: 10 })
    const [first, second] = await Promise.all([freshAccessToken(auth), freshAccessToken(auth)])
    expect(first).toBe("renewed-token")
    expect(second).toBe("renewed-token")
    expect(auth.signinSilent).toHaveBeenCalledOnce()
  })
})
