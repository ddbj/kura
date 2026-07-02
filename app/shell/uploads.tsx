import { useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { useT } from "~/lib/i18n"
import { startUpload } from "~/lib/s3/upload"
import { useS3 } from "~/lib/s3/use-s3"
import { Button, useToasts } from "~/ui"

type UploadsApi = {
  startUploads: (bucket: string, prefix: string, files: File[]) => void
}

const UploadsContext = createContext<UploadsApi | null>(null)

export const useUploads = (): UploadsApi => {
  const api = useContext(UploadsContext)
  if (api === null) {
    throw new Error("useUploads must be used within an UploadsProvider")
  }

  return api
}

// Lives above the route tree so navigating between directories does not
// unmount in-flight uploads; progress is reported through toasts.
export const UploadsProvider = ({ children }: { children: ReactNode }) => {
  const s3 = useS3()
  const toasts = useToasts()
  const queryClient = useQueryClient()
  const t = useT()
  const [activeCount, setActiveCount] = useState(0)

  useEffect(() => {
    if (activeCount === 0) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)

    return () => window.removeEventListener("beforeunload", warn)
  }, [activeCount])

  const startUploads = useCallback((bucket: string, prefix: string, files: File[]): void => {
    for (const file of files) {
      const key = `${prefix}${file.name}`
      // The cancel action is created before the transfer starts, so it aborts
      // through this mutable handle.
      const cancel = { requested: false, abort: (): void => undefined }

      setActiveCount((count) => count + 1)
      const id = toasts.show({
        kind: "progress",
        title: file.name,
        description: key,
        progress: { loaded: 0, total: file.size },
        action: (
          <Button
            kind="ghost"
            size="sm"
            onClick={() => {
              cancel.requested = true
              cancel.abort()
            }}
          >
            {t("common.cancel")}
          </Button>
        ),
      })

      const running = startUpload({
        s3,
        bucket,
        key,
        file,
        onProgress: (progress) => toasts.update(id, { progress }),
      })
      cancel.abort = () => void running.abort()

      running.done
        .then(() => {
          toasts.update(id, {
            kind: "success",
            description: t("upload.done"),
            progress: undefined,
            action: undefined,
          })

          return queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
        })
        .catch((error: unknown) => {
          if (cancel.requested) {
            toasts.dismiss(id)

            return
          }
          const message = error instanceof Error ? error.message : String(error)
          toasts.update(id, {
            kind: "error",
            description: `${t("upload.failed")}: ${message}`,
            progress: undefined,
            action: undefined,
          })
        })
        .finally(() => setActiveCount((count) => count - 1))
    }
  }, [s3, toasts, queryClient, t])

  const api = useMemo(() => ({ startUploads }), [startUploads])

  return <UploadsContext.Provider value={api}>{children}</UploadsContext.Provider>
}
