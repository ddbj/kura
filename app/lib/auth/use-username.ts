import { useMemo } from "react"
import { useAuth } from "react-oidc-context"

import { usernameFromAccessToken } from "./token"

export const useUsername = (): string => {
  const auth = useAuth()
  const token = auth.user?.access_token
  return useMemo(() => {
    if (token === undefined) {
      throw new Error("useUsername requires an authenticated session (render inside RequireAuth)")
    }
    return usernameFromAccessToken(token)
  }, [token])
}
