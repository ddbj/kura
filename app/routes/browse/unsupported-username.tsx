import { Callout } from "~/ui"

type Props = {
  username: string
}

export const UnsupportedUsername = ({ username }: Props) => (
  <div className="wrap" style={{ paddingTop: 32 }}>
    <Callout tone="warn">
      <p style={{ margin: "0 0 6px", fontWeight: 700 }}>このユーザー名では kura を利用できません</p>
      <p style={{ margin: 0 }}>
        ユーザー名 <span className="mono">{username}</span> は S3 バケット命名規則 (小文字英数と <span className="mono">. -</span> のみ、3–63 文字、先頭末尾は英数字) に適合しないため、kura の領域を作成できません。
      </p>
    </Callout>
  </div>
)
