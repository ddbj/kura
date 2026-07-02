import { useTranslation } from "react-i18next"

type TFn = (key: string, options?: Record<string, unknown>) => string

export const useT = (): TFn => {
  const { t } = useTranslation()

  return (key, options) =>
    (options === undefined ? t(key) : t(key, options)) as string
}
