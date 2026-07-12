import { useAuth } from "react-oidc-context"
import { Link } from "react-router"

import { usernameFromAccessToken } from "~/lib/auth/token"

import { LangSwitch } from "./lang-switch"
import { UserMenu } from "./user-menu"

export const Header = () => {
  const auth = useAuth()
  const token = auth.user?.access_token
  let username: string | undefined
  if (token !== undefined) {
    try {
      username = usernameFromAccessToken(token)
    } catch {
      username = undefined
    }
  }

  return (
    <div className="hdr">
      <div className="hdr-in">
        <Link to="/" className="wordmark">kura</Link>
        <div className="hdr-right">
          <LangSwitch />
          <div className="divider" />
          {username === undefined ? null : <UserMenu username={username} />}
        </div>
      </div>
    </div>
  )
}
