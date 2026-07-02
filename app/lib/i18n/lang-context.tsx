import { createContext, type ReactNode, useCallback, useEffect, useState } from "react"
import { I18nextProvider } from "react-i18next"

import { createI18nInstance } from "./instance"
import type { Lang } from "./lang"
import { LANG_STORAGE_KEY, resolveLangFromBrowser } from "./lang"

type LangContextValue = {
  lang: Lang
  setLang: (lang: Lang) => void
}

export const LangContext = createContext<LangContextValue | null>(null)

export const LangProvider = ({ children, initialLang }: { children: ReactNode; initialLang?: Lang }) => {
  const [lang, setLangState] = useState<Lang>(() => initialLang ?? resolveLangFromBrowser())
  const [i18n] = useState(() => createI18nInstance(lang))

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    window.localStorage.setItem(LANG_STORAGE_KEY, next)
    void i18n.changeLanguage(next)
  }, [i18n])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  // A ?lang= hint is a one-shot override: persist it and drop it from the URL
  // so the stored preference (and later switches) win on reload.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has("lang")) {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang)
      url.searchParams.delete("lang")
      window.history.replaceState(window.history.state, "", url)
    }
    // Runs once on mount; `lang` is the already-resolved initial language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LangContext.Provider>
  )
}
