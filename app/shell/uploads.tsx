import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3"
import { useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

import type { RunningUpload, UploadProgress } from "~/lib/s3"
import { ResumeMismatchError, resumeUpload, startUpload } from "~/lib/s3"
import { useS3 } from "~/lib/s3/use-s3"

export type TransferState =
  | "checking"
  | "queued"
  | "uploading"
  | "paused"
  | "conflict"
  | "failed"
  | "done"

export type Transfer = {
  id: string
  bucket: string
  key: string
  name: string
  size: number
  state: TransferState
  loaded: number
  total: number
  speedBps?: number | undefined
  error?: string | undefined
  isFolder?: boolean | undefined
  fileCount?: number | undefined
}

type TransfersApi = {
  transfers: readonly Transfer[]
  activeKeys: ReadonlySet<string>
  enqueue: (bucket: string, prefix: string, files: File[]) => void
  overwrite: (id: string) => void
  saveAs: (id: string) => void
  skip: (id: string) => void
  cancel: (id: string) => void
  retry: (id: string) => void
  cancelAll: () => void
  // Removes every row that isn't actively running (done / failed / conflict /
  // paused). Wired to the upcard's "閉じる" button, which only appears when
  // there is no in-flight work.
  dismissAll: () => void
  resumePending: (bucket: string, key: string, uploadId: string, file: File) => void
}

const TransfersContext = createContext<TransfersApi | null>(null)

export const useTransfers = (): TransfersApi => {
  const api = useContext(TransfersContext)
  if (api === null) throw new Error("useTransfers must be used within a TransfersProvider")

  return api
}

const objectExists = async (s3: S3Client, bucket: string, key: string): Promise<boolean> => {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))

    return true
  } catch (err) {
    const status = typeof err === "object" && err !== null && "$metadata" in err
      ? (err as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode
      : undefined
    if (status === 404 || status === 403) return false
    throw err
  }
}

const renameKey = (key: string): string => {
  const slash = key.lastIndexOf("/")
  const dir = slash === -1 ? "" : key.slice(0, slash + 1)
  const name = slash === -1 ? key : key.slice(slash + 1)
  const dot = name.lastIndexOf(".")
  const stem = dot <= 0 ? name : name.slice(0, dot)
  const ext = dot <= 0 ? "" : name.slice(dot)
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)

  return `${dir}${stem}-${stamp}${ext}`
}

// Runs uploads sequentially by default to keep the "queued" state honest and
// avoid saturating the network. lib-storage itself parallelizes parts inside a
// single upload, so throughput is retained.
const MAX_CONCURRENT = 1

// How long a completed row lingers so the user can register "完了" before the
// row (and eventually the whole upcard) is auto-dismissed. Failed / conflict
// rows never auto-dismiss because they require a decision from the user.
const AUTO_DISMISS_MS = 4000

type Running = { id: string; abort: () => Promise<void> }

export const UploadsProvider = ({ children }: { children: ReactNode }) => {
  const s3 = useS3()
  const queryClient = useQueryClient()
  const [transfers, setTransfers] = useState<readonly Transfer[]>([])
  const runningMap = useRef(new Map<string, Running>())
  // File objects live outside React state because they aren't serialisable
  // and only the transfer state needs to re-render.
  const filesRef = useRef(new Map<string, File>())
  const runningCountRef = useRef(0)
  const transfersRef = useRef<readonly Transfer[]>(transfers)
  useEffect(() => {
    transfersRef.current = transfers
  }, [transfers])

  const activeKeys = useMemo(() => {
    const set = new Set<string>()
    for (const t of transfers) {
      if (t.state === "uploading" || t.state === "queued" || t.state === "paused" || t.state === "checking") {
        set.add(`${t.bucket}/${t.key}`)
      }
    }

    return set
  }, [transfers])

  const activeCount = useMemo(() =>
    transfers.filter((t) => t.state === "uploading" || t.state === "queued" || t.state === "checking").length
  , [transfers])

  useEffect(() => {
    if (activeCount === 0) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)

    return () => window.removeEventListener("beforeunload", warn)
  }, [activeCount])

  const updateOne = useCallback((id: string, patch: Partial<Transfer>) => {
    setTransfers((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t))
  }, [])

  const removeOne = useCallback((id: string) => {
    setTransfers((prev) => prev.filter((t) => t.id !== id))
    filesRef.current.delete(id)
  }, [])

  const runTransferRef = useRef<(id: string, key: string) => void>(() => undefined)

  const runTransfer = useCallback((id: string, key: string): void => {
    const file = filesRef.current.get(id)
    if (file === undefined) return
    const transfer = transfersRef.current.find((t) => t.id === id)
    if (transfer === undefined) return
    const bucket = transfer.bucket

    runningCountRef.current += 1
    updateOne(id, { state: "uploading", loaded: 0, key, error: undefined })

    const cancelState = { requested: false }
    let lastProgressAt = performance.now()
    let lastLoaded = 0
    const onProgress = (progress: UploadProgress) => {
      const now = performance.now()
      const dt = now - lastProgressAt
      const dl = progress.loaded - lastLoaded
      const speedBps = dt > 300 && dl > 0 ? Math.max(0, (dl / dt) * 1000) : undefined
      if (dt > 300) {
        lastProgressAt = now
        lastLoaded = progress.loaded
      }
      updateOne(id, {
        loaded: progress.loaded,
        total: progress.total,
        ...(speedBps === undefined ? {} : { speedBps }),
      })
    }
    const running: RunningUpload = startUpload({ s3, bucket, key, file, onProgress })
    runningMap.current.set(id, {
      id,
      abort: async () => {
        cancelState.requested = true
        await running.abort()
      },
    })

    running.done
      .then(() => {
        updateOne(id, { state: "done", loaded: file.size, total: file.size })
        void queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
        void queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
        // Auto-dismiss completed rows so the upcard collapses once everything
        // succeeds. Failures / conflicts stick until the user acts on them.
        setTimeout(() => removeOne(id), AUTO_DISMISS_MS)
      })
      .catch((error: unknown) => {
        if (cancelState.requested) {
          void queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
          removeOne(id)

          return
        }
        const message = error instanceof ResumeMismatchError
          ? "content mismatch"
          : error instanceof Error ? error.message : String(error)
        updateOne(id, { state: "failed", error: message })
        void queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
      })
      .finally(() => {
        runningMap.current.delete(id)
        runningCountRef.current -= 1
        // Kick the queue: if any queued transfers remain, promote one.
        const next = transfersRef.current.find((t) => t.state === "queued")
        if (next !== undefined && runningCountRef.current < MAX_CONCURRENT) {
          runTransferRef.current(next.id, next.key)
        }
      })
  }, [s3, queryClient, updateOne, removeOne])

  useEffect(() => {
    runTransferRef.current = runTransfer
  }, [runTransfer])

  const enqueue = useCallback((bucket: string, prefix: string, files: File[]): void => {
    if (files.length === 0) return
    const now = Date.now()
    const added: Transfer[] = files.map((file, i) => ({
      id: `${now}-${i}-${file.name}`,
      bucket,
      key: `${prefix}${file.name}`,
      name: file.name,
      size: file.size,
      state: "checking",
      loaded: 0,
      total: file.size,
    }))
    for (const [i, t] of added.entries()) filesRef.current.set(t.id, files[i] as File)
    setTransfers((prev) => [...prev, ...added])

    // Concurrent HeadObject checks; each transitions to queued or conflict.
    for (const t of added) {
      void (async () => {
        try {
          const exists = await objectExists(s3, t.bucket, t.key)
          if (exists) {
            updateOne(t.id, { state: "conflict" })
          } else {
            updateOne(t.id, { state: "queued" })
            if (runningCountRef.current < MAX_CONCURRENT) {
              runTransferRef.current(t.id, t.key)
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          updateOne(t.id, { state: "failed", error: message })
        }
      })()
    }
  }, [s3, updateOne])

  const overwrite = useCallback((id: string): void => {
    const t = transfersRef.current.find((x) => x.id === id)
    if (t === undefined) return
    updateOne(id, { state: "queued" })
    if (runningCountRef.current < MAX_CONCURRENT) {
      runTransferRef.current(id, t.key)
    }
  }, [updateOne])

  const saveAs = useCallback((id: string): void => {
    const t = transfersRef.current.find((x) => x.id === id)
    if (t === undefined) return
    const newKey = renameKey(t.key)
    const newName = newKey.slice(newKey.lastIndexOf("/") + 1)
    updateOne(id, { state: "queued", key: newKey, name: newName })
    if (runningCountRef.current < MAX_CONCURRENT) {
      runTransferRef.current(id, newKey)
    }
  }, [updateOne])

  const skip = useCallback((id: string): void => {
    removeOne(id)
  }, [removeOne])

  const cancel = useCallback((id: string): void => {
    const r = runningMap.current.get(id)
    if (r !== undefined) {
      void r.abort()

      return
    }
    // Queued / conflict / failed: just remove.
    removeOne(id)
  }, [removeOne])

  const retry = useCallback((id: string): void => {
    const t = transfersRef.current.find((x) => x.id === id)
    if (t === undefined) return
    updateOne(id, { state: "queued", error: undefined })
    if (runningCountRef.current < MAX_CONCURRENT) {
      runTransferRef.current(id, t.key)
    }
  }, [updateOne])

  const cancelAll = useCallback((): void => {
    for (const [id, r] of runningMap.current.entries()) {
      void r.abort()
      updateOne(id, { state: "failed", error: "cancelled" })
    }
    setTransfers((prev) => prev.filter((t) =>
      t.state === "uploading" || t.state === "done" ? true : false,
    ))
    for (const t of transfersRef.current) {
      if (t.state === "queued" || t.state === "checking" || t.state === "conflict" || t.state === "failed" || t.state === "paused") {
        filesRef.current.delete(t.id)
      }
    }
  }, [updateOne])

  const dismissAll = useCallback((): void => {
    // Wired to the upcard "閉じる" button, which the UI only shows when nothing
    // is uploading / queued / checking. Every remaining row is a settled state
    // (done / failed / conflict / paused) that the user has acknowledged.
    for (const t of transfersRef.current) {
      if (t.state !== "uploading" && t.state !== "queued" && t.state !== "checking") {
        filesRef.current.delete(t.id)
      }
    }
    setTransfers((prev) => prev.filter((t) =>
      t.state === "uploading" || t.state === "queued" || t.state === "checking",
    ))
  }, [])

  const resumePending = useCallback((bucket: string, key: string, uploadId: string, file: File): void => {
    const id = `resume-${Date.now()}-${key}`
    filesRef.current.set(id, file)
    const t: Transfer = {
      id,
      bucket,
      key,
      name: file.name,
      size: file.size,
      state: "uploading",
      loaded: 0,
      total: file.size,
    }
    setTransfers((prev) => [...prev, t])
    runningCountRef.current += 1

    const cancelState = { requested: false }
    const running: RunningUpload = resumeUpload({
      s3, bucket, key, uploadId, file,
      onProgress: (progress) => updateOne(id, { loaded: progress.loaded, total: progress.total }),
    })
    runningMap.current.set(id, {
      id,
      abort: async () => {
        cancelState.requested = true
        await running.abort()
      },
    })
    running.done
      .then(() => {
        updateOne(id, { state: "done", loaded: file.size, total: file.size })
        void queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
        void queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
        setTimeout(() => removeOne(id), AUTO_DISMISS_MS)
      })
      .catch((error: unknown) => {
        if (cancelState.requested) {
          void queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
          removeOne(id)

          return
        }
        const message = error instanceof ResumeMismatchError
          ? "content mismatch"
          : error instanceof Error ? error.message : String(error)
        updateOne(id, { state: "failed", error: message })
        void queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
      })
      .finally(() => {
        runningMap.current.delete(id)
        runningCountRef.current -= 1
      })
  }, [s3, queryClient, updateOne, removeOne])

  const api = useMemo<TransfersApi>(() => ({
    transfers,
    activeKeys,
    enqueue,
    overwrite,
    saveAs,
    skip,
    cancel,
    retry,
    cancelAll,
    dismissAll,
    resumePending,
  }), [transfers, activeKeys, enqueue, overwrite, saveAs, skip, cancel, retry, cancelAll, dismissAll, resumePending])

  return <TransfersContext.Provider value={api}>{children}</TransfersContext.Provider>
}
