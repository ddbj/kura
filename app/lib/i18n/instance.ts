import { createInstance, type i18n as I18nInstance } from "i18next"
import { initReactI18next } from "react-i18next"

import type { Lang } from "./lang"
import { en } from "./resources/en"
import { ja } from "./resources/ja"

export const createI18nInstance = (lng: Lang): I18nInstance => {
  const instance = createInstance()
  void instance.use(initReactI18next).init({
    resources: {
      ja: { translation: ja },
      en: { translation: en },
    },
    lng,
    fallbackLng: "ja",
    interpolation: { escapeValue: false },
  })
  return instance
}
