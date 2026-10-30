import type { S3Client } from "@aws-sdk/client-s3"
import { useEffect, useMemo, useRef } from "react"
import type { AuthContextProps } from "react-oidc-context"
import { useAuth } from "react-oidc-context"

import { useConfig } from "~/lib/config"

import { createS3Client } from "./client"
import { createStsCredentialsProvider } from "./credentials"

// STS checks the access token only when it is called, and the session it
// returns does not end with the token. The token just has to outlive the
// round trip and the clock skew between the browser and the IdP.
const MIN_TOKEN_REMAINING_S = 30

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
