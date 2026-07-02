import { useAuth } from "react-oidc-context"
import { Link } from "react-router"

import { useUsername } from "~/lib/auth"
import { useT } from "~/lib/i18n"
import { Button } from "~/ui"

import { SwitchLang } from "./switch-lang"

// Rendered only when authenticated: useUsername requires a session.
const UserMenu = () => {
  const auth = useAuth()
  const username = useUsername()
  const t = useT()
  return (
    <div className="flex items-center gap-3">
      <span className="text-fs-body-sm text-ink-mid">{username}</span>
      <Button kind="ghost" size="sm" onClick={() => void auth.signoutRedirect()}>
        {t("shell.logout")}
      </Button>
    </div>
  )
}

export const Header = () => {
  const auth = useAuth()
  const t = useT()
  return (
    <header className="flex items-center justify-between border-b border-border-soft px-6 py-3">
      <div className="flex items-baseline gap-3">
        <Link to="/" className="text-fs-h3 font-bold text-brand no-underline">
          kura
        </Link>
        <span className="text-fs-body-sm text-ink-soft">{t("shell.tagline")}</span>
      </div>
      <div className="flex items-center gap-5">
        <SwitchLang />
        {auth.isAuthenticated ? <UserMenu /> : null}
      </div>
    </header>
  )
}
