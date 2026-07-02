import type { ReactNode } from "react"
import { useAuth } from "react-oidc-context"
import { useLocation } from "react-router"

import { useT } from "~/lib/i18n"
import { Button, Callout } from "~/ui"

export const RequireAuth = ({ children }: { children: ReactNode }) => {
  const auth = useAuth()
  const t = useT()
  const location = useLocation()
  const signin = () => void auth.signinRedirect({ state: location.pathname + location.search })

  if (auth.isLoading) {
    return <p className="p-6 text-ink-soft">{t("common.loading")}</p>
  }

  if (auth.error) {
    return (
      <div className="flex flex-col items-start gap-4 p-6">
        <Callout tone="warn" role="alert">
          {t("auth.errorTitle")}: {auth.error.message}
        </Callout>
        <Button onClick={signin}>{t("common.retry")}</Button>
      </div>
    )
  }

  if (!auth.isAuthenticated) {
    return (
      <div className="flex flex-col items-start gap-4 p-6">
        <p>{t("auth.loginRequired")}</p>
        <Button onClick={signin}>{t("shell.login")}</Button>
      </div>
    )
  }

  return <>{children}</>
}
