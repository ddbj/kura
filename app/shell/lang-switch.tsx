import { LANG_STORAGE_KEY, useLang, useSetLang } from "~/lib/i18n"
import { Icon } from "~/ui"

export const LangSwitch = () => {
  const lang = useLang()
  const setLang = useSetLang()
  const on = (next: "ja" | "en") => {
    window.localStorage.setItem(LANG_STORAGE_KEY, next)
    setLang(next)
  }

  return (
    <div className="lang">
      <Icon name="globe" size={14} />
      <button type="button" onClick={() => on("ja")} className={lang === "ja" ? undefined : "off"}>JA</button>
      <span className="sep">/</span>
      <button type="button" onClick={() => on("en")} className={lang === "en" ? undefined : "off"}>EN</button>
    </div>
  )
}
