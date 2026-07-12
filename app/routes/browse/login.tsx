import { Button, Icon } from "~/ui"

type Props = {
  onLogin: () => void
}

// Design_handoff frame 10.
export const LoginBox = ({ onLogin }: Props) => (
  <div className="login">
    <div className="loginbox">
      <div className="wm">kura</div>
      <p>大容量ファイルの保管・共有</p>
      <Button kind="pri" size="big" onClick={onLogin}>
        <Icon name="user" size={15} />
        DDBJ アカウントでログイン
      </Button>
    </div>
  </div>
)
