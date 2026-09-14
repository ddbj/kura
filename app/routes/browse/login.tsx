import { useT } from "~/lib/i18n"
import { Button, Icon } from "~/ui"

type Props = {
  onLogin: () => void
}

// Full-viewport centred card: the header is not mounted on this screen.
export const LoginBox = ({ onLogin }: Props) => {
  const t = useT()

  return (
    <div className="login">
      <div className="loginbox">
        <div className="wm">kura</div>
        <p>{t("shell.tagline")}</p>
        <Button kind="pri" size="big" onClick={onLogin}>
          <Icon name="user" size={15} />
          {t("shell.login")}
        </Button>
      </div>
    </div>
  )
}
