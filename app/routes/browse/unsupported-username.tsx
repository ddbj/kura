import { useT } from "~/lib/i18n"
import { Callout, NoticeStack } from "~/ui"

type Props = {
  username: string
}

export const UnsupportedUsername = ({ username }: Props) => {
  const t = useT()

  return (
    <div className="wrap">
      <NoticeStack>
        <Callout tone="warn">
          <p style={{ margin: "0 0 6px", fontWeight: 700 }}>{t("bucket.unsupportedUsernameTitle")}</p>
          <p style={{ margin: 0 }}>{t("bucket.unsupportedUsernameBody", { username })}</p>
        </Callout>
      </NoticeStack>
    </div>
  )
}
