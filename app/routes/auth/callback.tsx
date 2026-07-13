import { useAuth } from "react-oidc-context"
import { Navigate } from "react-router"

import { useT } from "~/lib/i18n"
import { TextLink } from "~/ui"

// Reject anything that is not a same-origin path (protocol-relative "//host",
// external URL, javascript:, etc.). Parsing against the current origin makes
// the check normative — any drift (leading whitespace, unicode digits in host,
// backslash tricks) falls back to "/" instead of being smuggled through by an
// ad-hoc prefix guard.
export const safeReturnTo = (state: unknown): string => {
  if (typeof state !== "string" || state === "") return "/"
  try {
    const url = new URL(state, window.location.origin)
    if (url.origin !== window.location.origin) return "/"

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return "/"
  }
}

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
    return <Navigate to={safeReturnTo(auth.user?.state)} replace />
  }

  return <p className="plain-text">{t("auth.processingCallback")}</p>
}

export default AuthCallback
