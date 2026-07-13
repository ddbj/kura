import type { S3Client } from "@aws-sdk/client-s3"
import { useEffect, useMemo, useRef } from "react"
import type { AuthContextProps } from "react-oidc-context"
import { useAuth } from "react-oidc-context"

import { useConfig } from "~/lib/config"

import { createS3Client } from "./client"
import { createStsCredentialsProvider } from "./credentials"

// Renew ahead of expiry so an STS session minted from this token does not die
// mid-action.
const MIN_TOKEN_REMAINING_S = 120

// A large multipart upload can have many parts in flight at once, each
// re-invoking the S3 SDK's credentials provider around the same time; without
// sharing one in-flight renewal, each would independently call signinSilent
// and race the same refresh token against Keycloak.
let inFlightRenewal: Promise<string> | null = null

const renewAccessToken = async (auth: AuthContextProps): Promise<string> => {
  if (inFlightRenewal !== null) return inFlightRenewal
  inFlightRenewal = (async () => {
    const renewed = await auth.signinSilent()
    if (renewed === null) {
      throw new Error("Silent renew did not return a session")
    }
    return renewed.access_token
  })()
  try {
    return await inFlightRenewal
  } finally {
    inFlightRenewal = null
  }
}

export const freshAccessToken = async (auth: AuthContextProps): Promise<string> => {
  const user = auth.user
  if (user && typeof user.expires_in === "number" && user.expires_in > MIN_TOKEN_REMAINING_S) {
    return user.access_token
  }
  return renewAccessToken(auth)
}

// presign's STS session length is capped by the access token's remaining
// life (docs/architecture.md presign), so renew whenever the cached token
// would cut the requested duration short - otherwise a requested 12h presign
// can silently get less if the token has, say, only 5 minutes left but is
// still above freshAccessToken's MIN_TOKEN_REMAINING_S reuse threshold.
export const accessTokenForDuration = async (auth: AuthContextProps, minRemainingS: number): Promise<string> => {
  const user = auth.user
  if (user && typeof user.expires_in === "number" && user.expires_in >= minRemainingS) {
    return user.access_token
  }
  return renewAccessToken(auth)
}

// One client per endpoint: the SDK re-invokes the credentials provider on
// expiry, and the provider always reads the latest auth state via the ref.
export const useS3 = (): S3Client => {
  const config = useConfig()
  const auth = useAuth()
  const authRef = useRef(auth)
  useEffect(() => {
    authRef.current = auth
  }, [auth])
  /* eslint-disable react-hooks/refs -- the provider closure runs when the SDK
     signs a request (post-render), never during render itself */
  return useMemo(
    () => {
      const getToken = () => freshAccessToken(authRef.current)
      return createS3Client(config.s3Endpoint, createStsCredentialsProvider(getToken, config.s3Endpoint))
    },
    [config.s3Endpoint],
  )
  /* eslint-enable react-hooks/refs */
}
