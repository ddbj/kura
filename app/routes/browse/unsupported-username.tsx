import { useT } from "~/lib/i18n"
import { Callout, Section } from "~/ui"

export const UnsupportedUsername = ({ username }: { username: string }) => {
  const t = useT()
  return (
    <Section>
      <Callout tone="warn" role="alert">
        <p className="font-semibold">{t("bucket.unsupportedUsernameTitle")}</p>
        <p className="mt-1">{t("bucket.unsupportedUsernameBody", { username })}</p>
      </Callout>
    </Section>
  )
}
