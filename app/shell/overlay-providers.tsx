import type { ReactNode } from "react"

import { useT } from "~/lib/i18n"
import { ToastProvider } from "~/ui"

import { UploadsProvider } from "./uploads"

// Toast + uploads live directly under LangProvider so toasts overlay every
// route and uploads survive navigation.
export const OverlayProviders = ({ children }: { children: ReactNode }) => {
  const t = useT()

  return (
    <ToastProvider dismissLabel={t("common.close")}>
      <UploadsProvider>{children}</UploadsProvider>
    </ToastProvider>
  )
}
