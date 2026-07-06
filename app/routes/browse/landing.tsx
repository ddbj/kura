import type { ReactNode } from "react"

import { useT } from "~/lib/i18n"
import { Button, Card, DownloadIcon, GlobeIcon, Heading, LinkIcon, Section, UploadIcon } from "~/ui"

const useCaseIconClass = "flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-brand-soft text-brand-deep"

const UseCase = ({ icon, title, body }: { icon: ReactNode; title: string; body: string }) => (
  <Card padding="md" className="flex flex-col gap-3">
    <span className={useCaseIconClass}>{icon}</span>
    <div>
      <Heading as="h3" className="mb-1">{title}</Heading>
      <p className="text-fs-body-sm text-ink-mid leading-relaxed">{body}</p>
    </div>
  </Card>
)

// Rendered by RequireAuth in place of the browse view while signed out: the
// only pre-login screen in the app, so it doubles as kura's top page.
export const Landing = ({ onSignIn }: { onSignIn: () => void }) => {
  const t = useT()

  return (
    <>
      <Section padTop="lg" padBottom="sm" narrow>
        <p className="font-mono text-fs-label uppercase tracking-eyebrow text-brand-deep">
          {t("landing.eyebrow")}
        </p>
        <Heading as="h1" className="mt-2">kura</Heading>
        <p className="mt-3 text-fs-body text-ink-mid leading-relaxed">{t("landing.heroLead")}</p>
        <p className="mt-1 text-fs-body text-ink-mid leading-relaxed">{t("auth.loginRequired")}</p>
        <div className="mt-5">
          <Button size="lg" onClick={onSignIn}>{t("shell.login")}</Button>
        </div>
      </Section>
      <Section padTop="sm" padBottom="lg">
        <Heading as="h2" bar>{t("landing.useCasesTitle")}</Heading>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <UseCase icon={<UploadIcon size={18} />} title={t("landing.uploadTitle")} body={t("landing.uploadBody")} />
          <UseCase icon={<DownloadIcon size={18} />} title={t("landing.downloadTitle")} body={t("landing.downloadBody")} />
          <UseCase icon={<GlobeIcon size={18} />} title={t("landing.publishTitle")} body={t("landing.publishBody")} />
          <UseCase icon={<LinkIcon size={18} />} title={t("landing.presignTitle")} body={t("landing.presignBody")} />
        </div>
      </Section>
    </>
  )
}
