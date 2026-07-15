import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3"
import { useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

import type { RunningUpload, UploadProgress } from "~/lib/s3"
import { copyObject, deleteEmptyDirectory, deleteObjects, listAllUnderPrefix, renameObject, ResumeMismatchError, resumeUpload, startUpload } from "~/lib/s3"
import { useS3 } from "~/lib/s3/use-s3"

export type TransferState =
  | "checking"
  | "queued"
  | "uploading"
  | "paused"
  | "conflict"
  | "failed"
  | "done"

export type OperationKind =
  | "upload"
  | "delete"
  | "rename"
  | "move"
  | "copy"
  | "folder-delete"
  | "folder-rename"
  | "folder-move"

export type Transfer = {
  id: string
  kind: OperationKind
  bucket: string
  // upload: destination key; delete (bulk): representative key; rename/move/copy: source key.
  key: string
  name: string
  // upload: file bytes. Other kinds: 0 (progress is item-based).
  size: number
  state: TransferState
  // upload: loaded bytes. Other kinds: items completed.
  loaded: number
  // upload: total bytes. Other kinds: items total.
  total: number
  speedBps?: number | undefined
  error?: string | undefined
  isFolder?: boolean | undefined
  fileCount?: number | undefined
  destKey?: string | undefined
  // Set on an upload once its multipart upload id is known. If a transfer
  // fails with this populated, retry can continue the same multipart via
  // resumeUpload instead of starting a fresh one.
  uploadId?: string | undefined
}

export type DeleteTarget = { key: string; size: number }
export type BatchOutcome<T> = { ok: T[]; failed: { key: string; message: string }[] }

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
  // Non-upload operations. Each returns a promise so callers can await
  // completion for query invalidation while the tray shows progress.
  enqueueDelete: (bucket: string, targets: DeleteTarget[]) => Promise<BatchOutcome<string>>
  enqueueRename: (bucket: string, srcKey: string, destKey: string) => Promise<void>
  enqueueMove: (bucket: string, srcKey: string, destKey: string) => Promise<void>
  enqueueCopy: (bucket: string, srcKey: string, destKey: string) => Promise<void>
  enqueueFolderDelete: (bucket: string, prefix: string) => Promise<BatchOutcome<string>>
  // srcPrefix / destPrefix both end with "/". Used for both rename (same
  // parent, different name) and move (different parent, same name).
  enqueueFolderMove: (bucket: string, srcPrefix: string, destPrefix: string, kind: "folder-rename" | "folder-move") => Promise<BatchOutcome<string>>
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

const entryName = (key: string): string => key.slice(key.lastIndexOf("/") + 1)

// Runs uploads sequentially by default to keep the "queued" state honest and
// avoid saturating the network. lib-storage itself parallelizes parts inside a
// single upload, so throughput is retained.
const MAX_CONCURRENT = 1

// Concurrency for the per-item loops inside a folder-scoped operation
// (delete / move). Small enough not to hammer the filer, big enough to hide
// per-request latency on a many-file folder.
const FOLDER_ITEM_CONCURRENCY = 5

// How long a completed row lingers so the user can register "完了" before the
// row (and eventually the whole upcard) is auto-dismissed. Failed / conflict
// rows never auto-dismiss because they require a decision from the user.
const AUTO_DISMISS_MS = 4000

type Running = { id: string; abort: () => Promise<void> }

let sequence = 0
const nextId = (kind: OperationKind): string => {
  sequence += 1

  return `${kind}-${Date.now()}-${sequence}`
}

// Runs an async worker over items with a fixed concurrency cap. Each worker
// gets a chance to fail independently and their failures are collected instead
// of aborting the whole batch — matches DeleteObjects's per-key error model.
const runBatch = async <T,>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  onEach: (item: T, index: number, result: { ok: true } | { ok: false; message: string }) => void,
): Promise<void> => {
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor
      cursor += 1
      if (i >= items.length) return
      const item = items[i] as T
      try {
        await worker(item, i)
        onEach(item, i, { ok: true })
      } catch (err) {
        onEach(item, i, { ok: false, message: err instanceof Error ? err.message : String(err) })
      }
    }
  })
  await Promise.all(runners)
}

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
      if (t.kind !== "upload") continue
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

  const promoteQueuedInto = useCallback((current: readonly Transfer[]): void => {
    if (runningCountRef.current >= MAX_CONCURRENT) return
    const next = current.find((t) => t.state === "queued" && t.kind === "upload")
    if (next !== undefined) runTransferRef.current(next.id, next.key)
  }, [])

  const runTransfer = useCallback((id: string, key: string): void => {
    const file = filesRef.current.get(id)
    if (file === undefined) return
    const transfer = transfersRef.current.find((t) => t.id === id)
    if (transfer === undefined) return
    const bucket = transfer.bucket

    runningCountRef.current += 1
    updateOne(id, { state: "uploading", loaded: 0, key, error: undefined, uploadId: undefined })

    const cancelState = { requested: false }
    let lastProgressAt = performance.now()
    let lastLoaded = 0
    let recordedUploadId: string | undefined
    const onProgress = (progress: UploadProgress) => {
      const now = performance.now()
      const dt = now - lastProgressAt
      const dl = progress.loaded - lastLoaded
      const speedBps = dt > 300 && dl > 0 ? Math.max(0, (dl / dt) * 1000) : undefined
      if (dt > 300) {
        lastProgressAt = now
        lastLoaded = progress.loaded
      }
      // Publish the multipart upload id once it appears so a retry after
      // failure can call resumeUpload instead of starting fresh.
      const currentUploadId = running.uploadId()
      const patch: Partial<Transfer> = {
        loaded: progress.loaded,
        total: progress.total,
      }
      if (speedBps !== undefined) patch.speedBps = speedBps
      if (currentUploadId !== undefined && currentUploadId !== recordedUploadId) {
        recordedUploadId = currentUploadId
        patch.uploadId = currentUploadId
      }
      updateOne(id, patch)
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
        updateOne(id, { state: "done", loaded: file.size, total: file.size, uploadId: undefined })
        void queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
        void queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
        void queryClient.invalidateQueries({ queryKey: ["bucket-usage", bucket] })
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
        const finalUploadId = running.uploadId()
        updateOne(id, {
          state: "failed",
          error: message,
          ...(finalUploadId === undefined ? {} : { uploadId: finalUploadId }),
        })
        void queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
      })
      .finally(() => {
        runningMap.current.delete(id)
        runningCountRef.current -= 1
        // Defer to a macrotask so React has committed the state update we
        // just enqueued (failed / done) and the transfers effect has synced
        // transfersRef.current. Promotion inside the setTransfers updater
        // would be a nested setState — banned by React.
        setTimeout(() => promoteQueuedInto(transfersRef.current), 0)
      })
  }, [s3, queryClient, updateOne, removeOne, promoteQueuedInto])

  useEffect(() => {
    runTransferRef.current = runTransfer
  }, [runTransfer])

  const enqueue = useCallback((bucket: string, prefix: string, files: File[]): void => {
    if (files.length === 0) return
    const now = Date.now()
    // A folder-picked File (webkitdirectory input) or a directory-walked drop
    // (walkEntry sets webkitRelativePath on each file) carries the subpath
    // starting with the dropped folder name; keying on it preserves the folder
    // structure under the current prefix. webkitRelativePath is missing on
    // jsdom's File shim so guard for undefined as well as the empty-string
    // "no subpath" browser convention.
    const relPath = (file: File): string => {
      const rel = file.webkitRelativePath as string | undefined
      return rel !== undefined && rel !== "" ? rel : file.name
    }
    const added: Transfer[] = files.map((file, i) => ({
      id: `${now}-${i}-${relPath(file)}`,
      kind: "upload",
      bucket,
      key: `${prefix}${relPath(file)}`,
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

  const runResume = useCallback((id: string, bucket: string, key: string, uploadId: string, file: File): void => {
    runningCountRef.current += 1
    updateOne(id, { state: "uploading", error: undefined, uploadId, key })

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
        updateOne(id, { state: "done", loaded: file.size, total: file.size, uploadId: undefined })
        void queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
        void queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
        void queryClient.invalidateQueries({ queryKey: ["bucket-usage", bucket] })
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
        updateOne(id, { state: "failed", error: message, uploadId })
        void queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
      })
      .finally(() => {
        runningMap.current.delete(id)
        runningCountRef.current -= 1
        // Defer promotion to after the failed-state commit lands. React
        // updaters must be pure and shouldn't kick more transfers; a microtask
        // reads the just-committed transfersRef.
        queueMicrotask(() => promoteQueuedInto(transfersRef.current))
      })
  }, [s3, queryClient, updateOne, removeOne, promoteQueuedInto])

  const retry = useCallback((id: string): void => {
    const t = transfersRef.current.find((x) => x.id === id)
    if (t === undefined) return
    const file = filesRef.current.get(id)
    // Same-session resume: if the multipart upload id is still recorded and
    // the File object is still in memory, continue the same upload rather
    // than starting fresh (which would leave abandoned parts behind).
    if (t.uploadId !== undefined && file !== undefined) {
      runResume(id, t.bucket, t.key, t.uploadId, file)

      return
    }
    updateOne(id, { state: "queued", error: undefined })
    if (runningCountRef.current < MAX_CONCURRENT) {
      runTransferRef.current(id, t.key)
    }
  }, [updateOne, runResume])

  const cancelAll = useCallback((): void => {
    for (const [id, r] of runningMap.current.entries()) {
      void r.abort()
      updateOne(id, { state: "failed", error: "cancelled" })
    }
    // Filter and clean up files inside the same updater so both operate on
    // the same snapshot; reading transfersRef in a separate step misses rows
    // added between the two updates.
    setTransfers((prev) => {
      const kept: Transfer[] = []
      for (const t of prev) {
        if (t.state === "uploading" || t.state === "done") {
          kept.push(t)
        } else {
          filesRef.current.delete(t.id)
        }
      }

      return kept
    })
  }, [updateOne])

  const dismissAll = useCallback((): void => {
    // Wired to the upcard "閉じる" button, which the UI only shows when nothing
    // is uploading / queued / checking. Every remaining row is a settled state
    // (done / failed / conflict / paused) that the user has acknowledged.
    setTransfers((prev) => {
      const kept: Transfer[] = []
      for (const t of prev) {
        if (t.state === "uploading" || t.state === "queued" || t.state === "checking") {
          kept.push(t)
        } else {
          filesRef.current.delete(t.id)
        }
      }

      return kept
    })
  }, [])

  const resumePending = useCallback((bucket: string, key: string, uploadId: string, file: File): void => {
    const id = `resume-${Date.now()}-${key}`
    filesRef.current.set(id, file)
    const t: Transfer = {
      id,
      kind: "upload",
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
        void queryClient.invalidateQueries({ queryKey: ["bucket-usage", bucket] })
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

  const finishOperation = useCallback((id: string, error?: string) => {
    if (error === undefined) {
      // Read total from React's own latest state (not transfersRef, which
      // effect-updated refs may still be catching up on).
      setTransfers((prev) => prev.map((t) => t.id === id ? { ...t, state: "done", loaded: t.total } : t))
      setTimeout(() => removeOne(id), AUTO_DISMISS_MS)
    } else {
      updateOne(id, { state: "failed", error })
    }
  }, [updateOne, removeOne])

  const enqueueDelete = useCallback(async (bucket: string, targets: DeleteTarget[]): Promise<BatchOutcome<string>> => {
    if (targets.length === 0) return { ok: [], failed: [] }
    const id = nextId("delete")
    const primary = targets[0] as DeleteTarget
    const displayName = targets.length === 1 ? entryName(primary.key) : `${targets.length} 件のファイル`
    const t: Transfer = {
      id,
      kind: "delete",
      bucket,
      key: primary.key,
      name: displayName,
      size: 0,
      state: "uploading",
      loaded: 0,
      total: targets.length,
    }
    setTransfers((prev) => [...prev, t])
    try {
      const res = await deleteObjects(s3, bucket, targets.map((x) => x.key))
      updateOne(id, { loaded: res.deleted.length })
      if (res.failed.length > 0) {
        finishOperation(id, `${res.failed.length} 件の削除に失敗しました`)
      } else {
        finishOperation(id)
      }
      void queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
      void queryClient.invalidateQueries({ queryKey: ["bucket-usage", bucket] })

      return { ok: res.deleted, failed: res.failed }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      finishOperation(id, message)

      return { ok: [], failed: targets.map((x) => ({ key: x.key, message })) }
    }
  }, [s3, queryClient, updateOne, finishOperation])

  const runSingleOp = useCallback(async (
    bucket: string,
    kind: "rename" | "move" | "copy",
    srcKey: string,
    destKey: string,
    action: () => Promise<void>,
  ): Promise<void> => {
    const id = nextId(kind)
    const t: Transfer = {
      id,
      kind,
      bucket,
      key: srcKey,
      destKey,
      name: entryName(srcKey),
      size: 0,
      state: "uploading",
      loaded: 0,
      total: 1,
    }
    setTransfers((prev) => [...prev, t])
    try {
      await action()
      updateOne(id, { loaded: 1 })
      finishOperation(id)
      void queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
      void queryClient.invalidateQueries({ queryKey: ["bucket-usage", bucket] })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      finishOperation(id, message)
      throw err
    }
  }, [queryClient, updateOne, finishOperation])

  const enqueueRename = useCallback(async (bucket: string, srcKey: string, destKey: string): Promise<void> => {
    await runSingleOp(bucket, "rename", srcKey, destKey, () => renameObject(s3, bucket, srcKey, destKey))
  }, [s3, runSingleOp])

  const enqueueMove = useCallback(async (bucket: string, srcKey: string, destKey: string): Promise<void> => {
    await runSingleOp(bucket, "move", srcKey, destKey, () => renameObject(s3, bucket, srcKey, destKey))
  }, [s3, runSingleOp])

  const enqueueCopy = useCallback(async (bucket: string, srcKey: string, destKey: string): Promise<void> => {
    await runSingleOp(bucket, "copy", srcKey, destKey, () => copyObject(s3, bucket, srcKey, destKey))
  }, [s3, runSingleOp])

  const enqueueFolderDelete = useCallback(async (bucket: string, prefix: string): Promise<BatchOutcome<string>> => {
    const id = nextId("folder-delete")
    const displayName = prefix === "" ? bucket : (prefix.slice(0, -1).split("/").pop() ?? prefix)
    const t: Transfer = {
      id,
      kind: "folder-delete",
      bucket,
      key: prefix,
      name: displayName,
      size: 0,
      state: "uploading",
      loaded: 0,
      total: 0,
      isFolder: true,
    }
    setTransfers((prev) => [...prev, t])
    try {
      const entries = await listAllUnderPrefix(s3, bucket, prefix)
      updateOne(id, { total: entries.length, fileCount: entries.length })
      const res = await deleteObjects(s3, bucket, entries.map((e) => e.key))
      updateOne(id, { loaded: res.deleted.length })
      if (res.failed.length > 0) {
        finishOperation(id, `${res.failed.length} 件の削除に失敗しました`)
      } else {
        finishOperation(id)
      }
      // SeaweedFS keeps an empty directory entry in the filer even after all
      // children are gone; without an explicit rmdir the folder keeps showing
      // up as a CommonPrefix. Best-effort — deleteEmptyDirectory swallows any
      // 404 for prefixes that were never materialized.
      await deleteEmptyDirectory(s3, bucket, prefix)
      void queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
      void queryClient.invalidateQueries({ queryKey: ["bucket-usage", bucket] })

      return { ok: res.deleted, failed: res.failed }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      finishOperation(id, message)

      return { ok: [], failed: [{ key: prefix, message }] }
    }
  }, [s3, queryClient, updateOne, finishOperation])

  const enqueueFolderMove = useCallback(async (
    bucket: string,
    srcPrefix: string,
    destPrefix: string,
    kind: "folder-rename" | "folder-move",
  ): Promise<BatchOutcome<string>> => {
    const id = nextId(kind)
    const displayName = srcPrefix === "" ? bucket : (srcPrefix.slice(0, -1).split("/").pop() ?? srcPrefix)
    const t: Transfer = {
      id,
      kind,
      bucket,
      key: srcPrefix,
      destKey: destPrefix,
      name: displayName,
      size: 0,
      state: "uploading",
      loaded: 0,
      total: 0,
      isFolder: true,
    }
    setTransfers((prev) => [...prev, t])
    try {
      const entries = await listAllUnderPrefix(s3, bucket, srcPrefix)
      updateOne(id, { total: entries.length, fileCount: entries.length })
      const ok: string[] = []
      const failed: { key: string; message: string }[] = []
      let done = 0
      await runBatch(entries, FOLDER_ITEM_CONCURRENCY, async (entry) => {
        const relative = entry.key.slice(srcPrefix.length)
        const dest = `${destPrefix}${relative}`
        await renameObject(s3, bucket, entry.key, dest)
      }, (entry, _i, result) => {
        done += 1
        updateOne(id, { loaded: done })
        if (result.ok) ok.push(entry.key)
        else failed.push({ key: entry.key, message: result.message })
      })
      if (failed.length > 0) {
        finishOperation(id, `${failed.length} 件の移動に失敗しました`)
      } else {
        finishOperation(id)
      }
      // Rename / move copies-and-deletes each key; the empty source directory
      // entry lingers in the SeaweedFS filer until we explicitly remove it.
      await deleteEmptyDirectory(s3, bucket, srcPrefix)
      void queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
      void queryClient.invalidateQueries({ queryKey: ["bucket-usage", bucket] })

      return { ok, failed }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      finishOperation(id, message)

      return { ok: [], failed: [{ key: srcPrefix, message }] }
    }
  }, [s3, queryClient, updateOne, finishOperation])

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
    enqueueDelete,
    enqueueRename,
    enqueueMove,
    enqueueCopy,
    enqueueFolderDelete,
    enqueueFolderMove,
  }), [transfers, activeKeys, enqueue, overwrite, saveAs, skip, cancel, retry, cancelAll, dismissAll, resumePending, enqueueDelete, enqueueRename, enqueueMove, enqueueCopy, enqueueFolderDelete, enqueueFolderMove])

  return <TransfersContext.Provider value={api}>{children}</TransfersContext.Provider>
}
