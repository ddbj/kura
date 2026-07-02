import { WebStorageStateStore } from "oidc-client-ts"
import type { AuthProviderProps } from "react-oidc-context"

import type { AppConfig } from "~/lib/config"

export const oidcProviderProps = (config: AppConfig): AuthProviderProps => ({
  authority: config.oidcIssuer,
  client_id: config.oidcClientId,
  // Derived from the current origin so the same build works behind any
  // registered redirect origin (vite dev server, nginx delivery).
  redirect_uri: `${window.location.origin}/_auth/callback`,
  post_logout_redirect_uri: window.location.origin,
  scope: "openid",
  // Keycloak issues refresh tokens to public PKCE clients, so renewal runs on
  // the refresh-token grant (no hidden iframe involved).
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  onSigninCallback: () => {
    // Drop code/state from the URL; the callback route navigates to the
    // original location afterwards (kept in user.state).
    window.history.replaceState(window.history.state, "", window.location.pathname)
  },
})
