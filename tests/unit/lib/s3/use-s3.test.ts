import type { AuthContextProps } from "react-oidc-context"
import { describe, expect, test, vi } from "vitest"

import { accessTokenForDuration, freshAccessToken } from "~/lib/s3/use-s3"

const fakeAuth = ({ expiresIn, renewedToken = "renewed-token" }: {
  expiresIn: number | undefined
  renewedToken?: string
}): AuthContextProps =>
  ({
    user: expiresIn === undefined ? null : { access_token: "stale-token", expires_in: expiresIn },
    signinSilent: vi.fn().mockResolvedValue({ access_token: renewedToken }),
  }) as unknown as AuthContextProps

describe("freshAccessToken", () => {
  test("remainingWellOverThreshold_reusesExistingToken", async () => {
    const auth = fakeAuth({ expiresIn: 3600 })
    await expect(freshAccessToken(auth)).resolves.toBe("stale-token")
    expect(auth.signinSilent).not.toHaveBeenCalled()
  })

  test("remainingAtOrBelowThreshold_renews", async () => {
    const auth = fakeAuth({ expiresIn: 120 })
    await expect(freshAccessToken(auth)).resolves.toBe("renewed-token")
    expect(auth.signinSilent).toHaveBeenCalledOnce()
  })
})

describe("accessTokenForDuration", () => {
  test("remainingCoversRequestedDuration_reusesExistingToken", async () => {
    const auth = fakeAuth({ expiresIn: 3600 })
    await expect(accessTokenForDuration(auth, 900)).resolves.toBe("stale-token")
    expect(auth.signinSilent).not.toHaveBeenCalled()
  })

  test("remainingShorterThanRequestedDuration_renewsEvenAboveGeneralThreshold", async () => {
    // 300s remaining is above freshAccessToken's 120s reuse threshold, but
    // short of the 900s (15 min) presign the caller asked for.
    const auth = fakeAuth({ expiresIn: 300 })
    await expect(accessTokenForDuration(auth, 900)).resolves.toBe("renewed-token")
    expect(auth.signinSilent).toHaveBeenCalledOnce()
  })

  test("silentRenewReturnsNull_throws", async () => {
    const auth = { user: null, signinSilent: vi.fn().mockResolvedValue(null) } as unknown as AuthContextProps
    await expect(accessTokenForDuration(auth, 900)).rejects.toThrow()
  })

  test("concurrentCallsNeedingRenewal_shareOneSigninSilentCall", async () => {
    const auth = fakeAuth({ expiresIn: 60 })
    const [first, second] = await Promise.all([
      accessTokenForDuration(auth, 900),
      accessTokenForDuration(auth, 900),
    ])
    expect(first).toBe("renewed-token")
    expect(second).toBe("renewed-token")
    expect(auth.signinSilent).toHaveBeenCalledOnce()
  })
})
