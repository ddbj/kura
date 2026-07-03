import { useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

import { useT } from "~/lib/i18n"
import type { RunningUpload, UploadProgress } from "~/lib/s3"
import { ResumeMismatchError, resumeUpload, startUpload } from "~/lib/s3"
import { useS3 } from "~/lib/s3/use-s3"
import { Button, useToasts } from "~/ui"

type UploadsApi = {
  startUploads: (bucket: string, prefix: string, files: File[]) => void
  // Continues an interrupted multipart upload found via listPendingUploads.
  resumePendingUpload: (bucket: string, key: string, uploadId: string, file: File) => void
  // `${bucket}/${key}` of transfers in flight; the pending-uploads list
  // filters these out so an active upload never shows as resumable.
  activeKeys: ReadonlySet<string>
}

const UploadsContext = createContext<UploadsApi | null>(null)

export const useUploads = (): UploadsApi => {
  const api = useContext(UploadsContext)
  if (api === null) {
    throw new Error("useUploads must be used within an UploadsProvider")
  }

  return api
}

type Transfer = {
  bucket: string
  key: string
  file: File
  start: (onProgress: (progress: UploadProgress) => void) => RunningUpload
  // Reuses the failed transfer's toast when resuming from its action button.
  toastId?: number
}

// Lives above the route tree so navigating between directories does not
// unmount in-flight uploads; progress is reported through toasts.
export const UploadsProvider = ({ children }: { children: ReactNode }) => {
  const s3 = useS3()
  const toasts = useToasts()
  const queryClient = useQueryClient()
  const t = useT()
  const [activeCount, setActiveCount] = useState(0)
  const [activeKeys, setActiveKeys] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (activeCount === 0) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)

    return () => window.removeEventListener("beforeunload", warn)
  }, [activeCount])

  // The resume action must restart the same transfer (a resume can fail and
  // offer resuming again), so the callback reaches itself through a ref.
  const runTransferRef = useRef<(transfer: Transfer) => void>(() => undefined)
  const runTransfer = useCallback((transfer: Transfer): void => {
    const { bucket, key, file } = transfer
    const activeKey = `${bucket}/${key}`
    // The cancel action is created before the transfer starts, so it aborts
    // through this mutable handle.
    const cancel = { requested: false, abort: (): void => undefined }

    setActiveCount((count) => count + 1)
    setActiveKeys((keys) => new Set(keys).add(activeKey))
    const progressToast = {
      kind: "progress" as const,
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
    }
    const id = transfer.toastId ?? toasts.show(progressToast)
    if (transfer.toastId !== undefined) {
      toasts.update(id, progressToast)
    }

    const running = transfer.start((progress) => toasts.update(id, { progress }))
    // The toast's final state for a cancel is decided here, once the
    // server-side discard actually settles, not by running.done rejecting
    // (which happens earlier and would race a failed discard).
    cancel.abort = () => {
      void running.abort().then(
        () => toasts.dismiss(id),
        () => toasts.update(id, {
          kind: "error",
          description: t("upload.cancelFailed"),
          progress: undefined,
          action: undefined,
        }),
      )
    }

    running.done
      .then(() => {
        toasts.update(id, {
          kind: "success",
          description: t("upload.done"),
          progress: undefined,
          action: undefined,
        })

        return Promise.all([
          queryClient.invalidateQueries({ queryKey: ["objects", bucket] }),
          queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] }),
        ])
      })
      .catch((error: unknown) => {
        if (cancel.requested) {
          void queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })

          return
        }
        // Failures leave the parts on the server; when the upload id is
        // known the toast offers to resume right away (the File is still in
        // memory). A content mismatch would fail again with the same file,
        // so it gets no resume action.
        const uploadId = running.uploadId()
        const mismatch = error instanceof ResumeMismatchError
        const message = error instanceof Error ? error.message : String(error)
        toasts.update(id, {
          kind: "error",
          description: mismatch ? t("upload.mismatch") : `${t("upload.failed")}: ${message}`,
          progress: undefined,
          action: uploadId === undefined || mismatch
            ? undefined
            : (
              <Button
                kind="ghost"
                size="sm"
                onClick={() => runTransferRef.current({
                  bucket,
                  key,
                  file,
                  toastId: id,
                  start: (onProgress) =>
                    resumeUpload({ s3, bucket, key, uploadId, file, onProgress }),
                })}
              >
                {t("upload.resume")}
              </Button>
            ),
        })
        void queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
      })
      .finally(() => {
        setActiveCount((count) => count - 1)
        setActiveKeys((keys) => {
          const next = new Set(keys)
          next.delete(activeKey)

          return next
        })
      })
  }, [s3, toasts, queryClient, t])

  useEffect(() => {
    runTransferRef.current = runTransfer
  }, [runTransfer])

  const api = useMemo<UploadsApi>(() => ({
    startUploads: (bucket, prefix, files) => {
      for (const file of files) {
        const key = `${prefix}${file.name}`
        runTransfer({
          bucket,
          key,
          file,
          start: (onProgress) => startUpload({ s3, bucket, key, file, onProgress }),
        })
      }
    },
    resumePendingUpload: (bucket, key, uploadId, file) => {
      runTransfer({
        bucket,
        key,
        file,
        start: (onProgress) => resumeUpload({ s3, bucket, key, uploadId, file, onProgress }),
      })
    },
    activeKeys,
  }), [runTransfer, s3, activeKeys])

  return <UploadsContext.Provider value={api}>{children}</UploadsContext.Provider>
}
