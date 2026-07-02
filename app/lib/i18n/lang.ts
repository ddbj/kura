export type Lang = "ja" | "en"

export const LANG_STORAGE_KEY = "kura.lang"

export const isLang = (value: unknown): value is Lang => value === "ja" || value === "en"

type LangHints = {
  searchLang: string | null
  storedLang: string | null
  navigatorLanguage: string
}

// Resolution order: explicit ?lang= hint, then the stored preference, then the
// browser language (ja only for the "ja" primary subtag; anything else is en).
export const resolveInitialLang = ({ searchLang, storedLang, navigatorLanguage }: LangHints): Lang => {
  if (isLang(searchLang)) return searchLang
  if (isLang(storedLang)) return storedLang
  const primary = navigatorLanguage.toLowerCase()
  return primary === "ja" || primary.startsWith("ja-") ? "ja" : "en"
}

export const resolveLangFromBrowser = (): Lang =>
  resolveInitialLang({
    searchLang: new URLSearchParams(window.location.search).get("lang"),
    storedLang: window.localStorage.getItem(LANG_STORAGE_KEY),
    navigatorLanguage: navigator.language,
  })
