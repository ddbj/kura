import type { Lang } from "~/lib/i18n"
import { useLang, useSetLang, useT } from "~/lib/i18n"
import { cn, GlobeIcon } from "~/ui"

const LangPill = ({ code, active }: { code: "JA" | "EN"; active: boolean }) => (
  <span
    className={cn(
      "text-fs-body-sm leading-none",
      active ? "text-ink font-bold" : "text-ink-mid font-normal",
    )}
  >
    {code}
  </span>
)

export const SwitchLang = () => {
  const lang = useLang()
  const setLang = useSetLang()
  const t = useT()
  const target: Lang = lang === "ja" ? "en" : "ja"

  return (
    <button
      type="button"
      aria-label={t("switchLang.label")}
      onClick={() => setLang(target)}
      className="inline-flex items-center gap-1.5 bg-transparent border-0 cursor-pointer p-0"
    >
      <GlobeIcon size={18} className="text-ink-mid" />
      <LangPill code="JA" active={lang === "ja"} />
      <span aria-hidden className="text-ink-softer">/</span>
      <LangPill code="EN" active={lang === "en"} />
    </button>
  )
}
