import type { UserManagerSettings } from "oidc-client-ts"
import { UserManager, WebStorageStateStore } from "oidc-client-ts"
import type { AuthProviderProps } from "react-oidc-context"

import type { AppConfig } from "~/lib/config"

const oidcSettings = (config: AppConfig): UserManagerSettings => ({
  authority: config.oidcIssuer,
  client_id: config.oidcClientId,
  // Derived from the current origin so the same build works behind any
  // registered redirect origin (the vite dev server, the delivery server).
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: window.location.origin,
  scope: "openid",
  // Keycloak issues refresh tokens to public PKCE clients, so renewal runs on
  // the refresh-token grant (no hidden iframe involved).
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
})

export const oidcProviderProps = (config: AppConfig): AuthProviderProps => ({
  ...oidcSettings(config),
  onSigninCallback: () => {
    // Drop code/state from the URL; the callback route navigates to the
    // original location afterwards (kept in user.state).
    window.history.replaceState(window.history.state, "", window.location.pathname)
  },
})

// Automatic renewal runs a minute before the access token expires, so a tab
// that was asleep past that point reopens with an expired token, and
// react-oidc-context treats an expired stored user as signed out. Renew it
// with the refresh token before the app renders. If that fails (the SSO
// session ended), drop the user so the login screen shows rather than an
// error. Without a refresh token there is nothing to renew with.
export const renewExpiredSession = async (config: AppConfig): Promise<void> => {
  // Not the AuthProvider's manager, which does not exist yet: a second one
  // over the same storage, without timers of its own.
  const manager = new UserManager({ ...oidcSettings(config), automaticSilentRenew: false })
  const user = await manager.getUser()
  if (user === null || !user.expired || user.refresh_token === undefined) return
  try {
    await manager.signinSilent()
  } catch {
    await manager.removeUser()
  }
}
