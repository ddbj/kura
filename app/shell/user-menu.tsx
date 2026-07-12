import { useEffect, useRef, useState } from "react"
import { useAuth } from "react-oidc-context"

import { useT } from "~/lib/i18n"
import { Icon } from "~/ui"

type Props = {
  username: string
}

export const UserMenu = ({ username }: Props) => {
  const auth = useAuth()
  const t = useT()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)

    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const signout = () => {
    setOpen(false)
    void auth.signoutRedirect({ post_logout_redirect_uri: window.location.origin })
      .catch(() => auth.removeUser())
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="user"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="user" size={15} />
        {username}
        <Icon name="caret" size={10} />
      </button>
      {open ? (
        <div className="usermenu" role="menu">
          <button type="button" role="menuitem" onClick={signout}>
            {t("shell.logout")}
          </button>
        </div>
      ) : null}
    </div>
  )
}
