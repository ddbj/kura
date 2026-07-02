import { useContext } from "react"

import type { Lang } from "./lang"
import { LangContext } from "./lang-context"

export const useLang = (): Lang => {
  const ctx = useContext(LangContext)
  if (ctx === null) {
    throw new Error("useLang must be used within a LangProvider")
  }
  return ctx.lang
}

export const useSetLang = (): ((lang: Lang) => void) => {
  const ctx = useContext(LangContext)
  if (ctx === null) {
    throw new Error("useSetLang must be used within a LangProvider")
  }
  return ctx.setLang
}
