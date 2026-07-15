import type { ReactNode } from "react"
import { useAuth } from "react-oidc-context"
import { useLocation } from "react-router"

import { useT } from "~/lib/i18n"
import { Button, Callout } from "~/ui"

type RequireAuthProps = {
  children: ReactNode
  // Rendered instead of the plain login prompt once signed-out state is
  // confirmed (e.g. the LoginBox landing page). Loading / error states
  // always use the default treatment regardless.
  fallback?: (signin: () => void) => ReactNode
}

export const RequireAuth = ({ children, fallback }: RequireAuthProps) => {
  const auth = useAuth()
  const t = useT()
  const location = useLocation()
  const signin = () => void auth.signinRedirect({ state: location.pathname + location.search })

  // Silent renew also flips isLoading to true while the refresh_token grant
  // is in flight; unmounting children in that window would tear down any open
  // modal / upload tray (~1 h into a session, on every access token refresh).
  // Only show the loading placeholder on the initial visit before any session
  // is established.
  if (auth.isLoading && !auth.isAuthenticated) {
    return <p className="plain-text">{t("common.loading")}</p>
  }

  if (auth.error) {
    return (
      <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
        <Callout tone="red" role="alert">
          {t("auth.errorTitle")}: {auth.error.message}
        </Callout>
        <Button onClick={signin}>{t("common.retry")}</Button>
      </div>
    )
  }

  if (!auth.isAuthenticated) {
    if (fallback !== undefined) return <>{fallback(signin)}</>

    return (
      <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
        <p>{t("auth.loginRequired")}</p>
        <Button kind="pri" onClick={signin}>{t("shell.login")}</Button>
      </div>
    )
  }

  return <>{children}</>
}
