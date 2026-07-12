import { useAuth } from "react-oidc-context"
import { Navigate } from "react-router"

import { useT } from "~/lib/i18n"
import { TextLink } from "~/ui"

// The AuthProvider consumes ?code/?state on its own; this route only reflects
// the resulting state and returns the user to where signin started.
const AuthCallback = () => {
  const auth = useAuth()
  const t = useT()

  if (auth.error) {
    return (
      <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
        <p role="alert">
          {t("auth.errorTitle")}: {auth.error.message}
        </p>
        <TextLink to="/">{t("auth.backToTop")}</TextLink>
      </div>
    )
  }

  if (auth.isAuthenticated) {
    const state = auth.user?.state
    // Same-origin paths only ("//host" would be protocol-relative).
    const returnTo = typeof state === "string" && state.startsWith("/") && !state.startsWith("//") ? state : "/"

    return <Navigate to={returnTo} replace />
  }

  return <p className="plain-text">{t("auth.processingCallback")}</p>
}

export default AuthCallback
