import { useCallback } from "react"
import { useTranslation } from "react-i18next"

export type TFn = (key: string, options?: Record<string, unknown>) => string

// Stable across renders for a given language so callers can list it in a
// useCallback / useEffect dependency array without re-creating on every render.
export const useT = (): TFn => {
  const { t } = useTranslation()

  return useCallback<TFn>(
    (key, options) => (options === undefined ? t(key) : t(key, options)) as string,
    [t],
  )
}
