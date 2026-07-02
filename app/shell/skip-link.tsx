import { useT } from "~/lib/i18n"

export const SkipLink = () => {
  const t = useT()
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-modal focus:px-3 focus:py-1.5 focus:bg-surface focus:border focus:border-border-soft focus:rounded-button focus:text-ink focus:font-semibold focus:no-underline"
    >
      {t("shell.skipToContent")}
    </a>
  )
}
