import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { DragEvent, MouseEvent as ReactMouseEvent } from "react"
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useAuth } from "react-oidc-context"
import { Link, useNavigate } from "react-router"

import { usernameFromAccessToken } from "~/lib/auth/token"
import { useConfig } from "~/lib/config"
import { formatBytes, formatDuration } from "~/lib/format"
import { formatListDateTime, useLang, useT } from "~/lib/i18n"
import {
  abortPendingUpload,
  DEFAULT_QUOTA_BYTES,
  dirName,
  ensureOwnBucket,
  entryName,
  isUsableBucketName,
  listBucketStats,
  listDirectory,
  listPendingUploads,
  listUploadedParts,
  planResume,
  prefixToSegments,
  prefixToUrlPath,
  presignDownloadUrl,
  type ZipEntry,
} from "~/lib/s3"
import { useS3 } from "~/lib/s3/use-s3"
import {
  listSessionPresigned,
  type SessionPresigned,
  sessionPresignedVersion,
  subscribeSessionPresigned,
} from "~/lib/session-presigned"
import { Header, RequireAuth, useTransfers } from "~/shell"
import {
  Button,
  Callout,
  Checkbox,
  Chip,
  cn,
  FolderNavButton,
  HiddenFileInput,
  Icon,
  IconButton,
  LinkBar,
  MenuItem,
  NoticeStack,
  SearchInput,
  SortButton,
  Tag,
} from "~/ui"

import { CopyModal } from "./copy-modal"
import { DeleteModal } from "./delete-modal"
import { FolderDeleteModal } from "./folder-delete-modal"
import { FolderMoveModal } from "./folder-move-modal"
import { FolderRenameModal } from "./folder-rename-modal"
import { LoginBox } from "./login"
import { MoveModal } from "./move-modal"
import { NewFolderModal } from "./new-folder-modal"
import { RenameModal } from "./rename-modal"
import { ShareModal } from "./share-modal"
import { UnsupportedUsername } from "./unsupported-username"
import { UploadCard } from "./upload-card"

type Props = { prefix: string }

// Route entry: RequireAuth gates the whole page; the fallback is the design's
// dedicated login screen, not the default plain button.
export const BrowsePage = ({ prefix }: Props) => (
  <RequireAuth fallback={(signin) => <LoginBox onLogin={signin} />}>
    <AuthenticatedBrowse prefix={prefix} />
  </RequireAuth>
)

const AuthenticatedBrowse = ({ prefix }: Props) => {
  const auth = useAuth()
  const token = auth.user?.access_token
  const username = useMemo(() => (token === undefined ? "" : usernameFromAccessToken(token)), [token])
  if (username === "") return <p className="plain-text">…</p>

  return (
    <>
      <Header />
      {isUsableBucketName(username)
        ? <Browse bucket={username} prefix={prefix} />
        : <UnsupportedUsername username={username} />}
    </>
  )
}

type SortKey = "name" | "size" | "updated"
type SortDir = "asc" | "desc"
type Lens = "all" | "timed"

// One shared ticker at page level drives every relative-time cell,
// instead of each row starting its own setInterval. Nulls until first mount so
// server rendering (should we ever wire it up) doesn't diverge from the client.
const NowContext = createContext<number | null>(null)

const NowProvider = ({ children }: { children: React.ReactNode }) => {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)

    return () => clearInterval(id)
  }, [])

  return <NowContext.Provider value={now}>{children}</NowContext.Provider>
}

const useNow = (): number | null => useContext(NowContext)

// Extracted so Date.now() lives outside render — the ticker updates every 30s.
const PresignExpiryLabel = ({ expiresAtMs }: { expiresAtMs: number }) => {
  const t = useT()
  const nowMs = useNow() ?? expiresAtMs
  const minutes = Math.max(0, Math.round((expiresAtMs - nowMs) / 60000))

  return <>{t("browse.presignPanelLabel", { duration: formatDuration(minutes, t) })}</>
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

const TtlExpiry = ({ createdMs, ttlDays }: { createdMs: number; ttlDays: number }) => {
  const t = useT()
  const nowMs = useNow()
  const expiresMs = createdMs + ttlDays * MS_PER_DAY
  if (nowMs === null) return null
  const remainingDays = Math.max(0, Math.ceil((expiresMs - nowMs) / MS_PER_DAY))

  return <>{t("browse.ttlRemaining", { days: remainingDays })}</>
}

const Browse = ({ bucket, prefix }: { bucket: string; prefix: string }) => (
  <NowProvider>
    <BrowseInner bucket={bucket} prefix={prefix} />
  </NowProvider>
)

const BrowseInner = ({ bucket, prefix }: { bucket: string; prefix: string }) => {
  const s3 = useS3()
  const config = useConfig()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const t = useT()
  const lang = useLang()
  const transfersApi = useTransfers()

  const bucketReady = useQuery({
    queryKey: ["ensure-bucket", bucket],
    queryFn: async () => {
      await ensureOwnBucket(s3, bucket)

      return true
    },
    staleTime: Infinity,
  })

  const directory = useQuery({
    queryKey: ["objects", bucket, prefix],
    queryFn: () => listDirectory(s3, bucket, prefix),
    enabled: bucketReady.data === true,
  })

  const usage = useQuery({
    queryKey: ["bucket-usage", bucket],
    queryFn: () => listBucketStats(s3, bucket),
    enabled: bucketReady.data === true,
    staleTime: 60_000,
  })

  const pendingUploads = useQuery({
    queryKey: ["pendingUploads", bucket, prefix],
    queryFn: () => listPendingUploads(s3, bucket, prefix),
    enabled: bucketReady.data === true,
    staleTime: 30_000,
  })

  // .keep marker files are how "new folder" is materialized in S3; they must
  // never surface as user-visible rows nor keep the emptyzone from rendering
  // (a folder containing only its own .keep is functionally empty).
  const files = useMemo(
    () => (directory.data?.files ?? []).filter((f) => entryName(f.key) !== ".keep"),
    [directory.data?.files],
  )
  const dirs = useMemo(() => directory.data?.dirs ?? [], [directory.data?.dirs])

  // Session-local presigned URL log fuels the timed-link lens.
  // The 30 s tick only exists to expire rows past their `expiresAt`; if the log
  // is empty there is nothing to age, so the interval is a no-op that we skip.
  const [presignedTick, setPresignedTick] = useState(0)
  const presignedListInitial = useMemo(() => listSessionPresigned(bucket), [bucket])
  const [hasPresigned, setHasPresigned] = useState(presignedListInitial.length > 0)
  useEffect(() => {
    if (!hasPresigned) return
    const id = setInterval(() => setPresignedTick((v) => v + 1), 30_000)

    return () => clearInterval(id)
  }, [hasPresigned])
  // 発行・破棄 (rename / move / delete に伴う) はどちらも store 側の書き換えなので、
  // 件数と行が同じ version を見て読み直すようにする。転送の状態を数える方式だと
  // 書き換えの取りこぼしが lens の数字だけに残る。
  const presignedVersion = useSyncExternalStore(
    subscribeSessionPresigned,
    sessionPresignedVersion,
    sessionPresignedVersion,
  )
  const presignedList = useMemo<SessionPresigned[]>(
    () => listSessionPresigned(bucket),
    // presignedTick は失効した行を落とすための定期読み直し。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucket, presignedTick, presignedVersion],
  )
  useEffect(() => {
    setHasPresigned(presignedList.length > 0)
  }, [presignedList.length])
  const presignedByKey = useMemo(() => {
    const m = new Map<string, SessionPresigned>()
    for (const p of presignedList) m.set(p.key, p)

    return m
  }, [presignedList])

  // Toolbar / table state
  const [search, setSearch] = useState("")
  const [lens, setLens] = useState<Lens>("all")
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "updated", dir: "desc" })
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null)
  const [uploadMenuOpen, setUploadMenuOpen] = useState<"header" | "empty" | null>(null)
  const [share, setShare] = useState<{ bucket: string; key: string; name: string; size: number }[] | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<{ bucket: string; key: string; name: string; size: number }[] | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(new Set())
  const [openFolderMenu, setOpenFolderMenu] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<string | null>(null)
  const [copyTarget, setCopyTarget] = useState<string | null>(null)
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<{ prefix: string; name: string } | null>(null)
  const [folderRenameTarget, setFolderRenameTarget] = useState<{ prefix: string; name: string } | null>(null)
  const [folderMoveTarget, setFolderMoveTarget] = useState<{ prefix: string; name: string } | null>(null)
  const [flash, setFlash] = useState<{ tone: "red" | "ok" | "warn"; message: string } | null>(null)

  // ページ全体で出す恒久的な notice (bucket-init / quota / list) の dismiss 状態。
  // Callout の × でユーザーが閉じたら true に。エラーが更新されたら false に戻して
  // 新しいエラーは必ず再表示されるようにする。
  const [noticeDismissed, setNoticeDismissed] = useState({ bucket: false, quota: false, list: false })
  useEffect(() => {
    if (bucketReady.isError) setNoticeDismissed((d) => (d.bucket ? { ...d, bucket: false } : d))
  }, [bucketReady.errorUpdatedAt, bucketReady.isError])
  useEffect(() => {
    if (directory.isError) setNoticeDismissed((d) => (d.list ? { ...d, list: false } : d))
  }, [directory.errorUpdatedAt, directory.isError])

  const closeAllMenus = useCallback(() => {
    setOpenRowMenu(null)
    setUploadMenuOpen(null)
    setOpenFolderMenu(null)
  }, [])

  // Row-menu / folder-menu / upload-menu keyboard + outside close. Escape
  // closes; ArrowUp / ArrowDown move focus between the visible menu's items;
  // Tab leaves the menu (roving tabindex — focus goes wherever Tab would
  // normally land next).
  useEffect(() => {
    if (openRowMenu === null && !uploadMenuOpen && openFolderMenu === null) return
    const onClick = () => closeAllMenus()
    // Delay so the click that opened doesn't close instantly.
    const timer = setTimeout(() => document.addEventListener("click", onClick), 0)

    const currentMenuItems = (): HTMLElement[] => {
      const menus = document.querySelectorAll<HTMLElement>("[role=menu]")
      const items: HTMLElement[] = []
      for (const menu of Array.from(menus)) {
        for (const item of Array.from(menu.querySelectorAll<HTMLElement>("[role=menuitem]"))) {
          items.push(item)
        }
      }

      return items
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeAllMenus()

        return
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items = currentMenuItems()
        if (items.length === 0) return
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const idx = active === null ? -1 : items.indexOf(active)
        const nextIdx = event.key === "ArrowDown"
          ? (idx + 1 + items.length) % items.length
          : (idx - 1 + items.length) % items.length
        const next = items[nextIdx]
        if (next !== undefined) {
          event.preventDefault()
          next.focus()
        }

        return
      }
      if (event.key === "Tab") {
        closeAllMenus()
      }
    }
    document.addEventListener("keydown", onKey)

    return () => {
      clearTimeout(timer)
      document.removeEventListener("click", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [openRowMenu, uploadMenuOpen, openFolderMenu, closeAllMenus])

  const used = usage.data?.totalBytes ?? 0
  const folderStats = usage.data?.folders
  const total = DEFAULT_QUOTA_BYTES
  const overQuota = used >= total
  const usagePct = Math.min(100, (used / total) * 100)
  useEffect(() => {
    if (overQuota) setNoticeDismissed((d) => (d.quota ? { ...d, quota: false } : d))
  }, [overQuota])

  const visibleDirs = useMemo(() => {
    if (lens === "timed") return []

    return dirs.filter((d) => search === "" || dirName(d).toLowerCase().includes(search.toLowerCase()))
  }, [dirs, lens, search])

  const rows = useMemo(() => {
    const filtered = files.filter((f) => {
      const name = entryName(f.key).toLowerCase()
      if (search !== "" && !name.includes(search.toLowerCase())) return false
      if (lens === "timed" && !presignedByKey.has(f.key)) return false

      return true
    })
    const sorted = [...filtered].sort((a, b) => {
      const cmp = sort.key === "name"
        ? entryName(a.key).localeCompare(entryName(b.key))
        : sort.key === "size"
          ? (a.size ?? 0) - (b.size ?? 0)
          : a.lastModified.getTime() - b.lastModified.getTime()

      return sort.dir === "asc" ? cmp : -cmp
    })

    return sorted
  }, [files, presignedByKey, search, lens, sort])

  const presignedCount = useMemo(
    () => files.filter((f) => presignedByKey.has(f.key)).length,
    [files, presignedByKey],
  )
  const totalCount = files.length + dirs.length

  const anyRowInPrefix = totalCount > 0
  const noResultsAfterSearch = search !== "" && rows.length === 0 && anyRowInPrefix
  // 期限つきで絞った結果が空。ファイル自体はあるので emptyzone とは区別する。
  const noTimedResults = lens === "timed" && rows.length === 0 && anyRowInPrefix

  const toggleSort = (key: SortKey) => {
    setSort((prev) => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" })
  }

  const clearSelection = () => setSelection(new Set())

  // zip 名は今いる場所から採る。root では bucket 名。
  const currentFolderName = prefix === "" ? bucket : (prefixToSegments(prefix).at(-1) ?? bucket)

  const downloadSelection = async (keys: readonly string[]) => {
    const entries: ZipEntry[] = files
      .filter((f) => keys.includes(f.key))
      .map((f) => ({ key: f.key, name: entryName(f.key), size: f.size ?? 0, lastModified: f.lastModified }))
    if (entries.length === 0) return
    clearSelection()
    await transfersApi.enqueueZipDownload(bucket, entries, `${currentFolderName}.zip`)
  }

  const downloadFolder = async (dirPrefix: string, folderName: string) => {
    try {
      await transfersApi.enqueueFolderZipDownload(bucket, dirPrefix, `${folderName}.zip`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ tone: "red", message: t("notice.downloadFailed", { message }) })
    }
  }

  const toggleSelection = (key: string) => {
    setSelection((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)

      return next
    })
  }

  const toggleExpanded = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)

      return next
    })
  }

  // Row click toggles the presignpanel, but never when the user
  // clicked into an interactive descendant (checkbox, action button, kebab,
  // filename link). closest() walks up from the click target and returns null
  // on a non-interactive area — that's the toggle zone.
  const onRowActivate = (event: ReactMouseEvent<HTMLDivElement>, key: string) => {
    const target = event.target as HTMLElement
    if (target.closest("button, a, input") !== null) return
    toggleExpanded(key)
  }

  const download = async (key: string) => {
    try {
      const url = await presignDownloadUrl(s3, bucket, key)
      window.location.assign(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ tone: "red", message: t("notice.downloadFailed", { message }) })
    }
  }

  const copyShareUrl = async (key: string) => {
    const url = presignedByKey.get(key)?.url
    if (url === undefined) return
    try {
      await navigator.clipboard.writeText(url)
      setFlash({ tone: "ok", message: t("notice.linkCopied") })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ tone: "red", message: t("notice.copyFailed", { message }) })
    }
  }

  const openShare = (keys: string[]) => {
    const targets = keys.flatMap<{ bucket: string; key: string; name: string; size: number }>((k) => {
      const f = files.find((x) => x.key === k)
      if (f === undefined) return []

      return [{ bucket, key: f.key, name: entryName(f.key), size: f.size ?? 0 }]
    })
    if (targets.length === 0) return
    setShare(targets)
  }

  const openDelete = (keys: string[]) => {
    const targets = keys.flatMap<{ bucket: string; key: string; name: string; size: number }>((k) => {
      const f = files.find((x) => x.key === k)
      if (f === undefined) return []

      return [{ bucket, key: f.key, name: entryName(f.key), size: f.size ?? 0 }]
    })
    if (targets.length === 0) return
    setDeleteTargets(targets)
  }

  // Upload via file picker or drop
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const onFilesChosen = (fileList: FileList | null) => {
    if (fileList === null || fileList.length === 0) return
    const arr: File[] = []
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList.item(i)
      if (f !== null) arr.push(f)
    }
    transfersApi.enqueue(bucket, prefix, arr)
  }

  // dragenter/dragleave fires when the pointer crosses any descendant
  // boundary, so a naive `isDragging` toggle flickers. Counting enter/leave
  // pairs across children stays true until the pointer actually leaves the
  // drop target. Ref (not state) so successive events aren't batched.
  const dragDepthRef = useRef(0)

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return
    event.preventDefault()
    dragDepthRef.current += 1
    if (!overQuota) setIsDragging(true)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return
    // preventDefault on both dragenter AND dragover is required for drop
    // to fire (browser default is to reject the drop).
    event.preventDefault()
    if (overQuota) event.dataTransfer.dropEffect = "none"
    else event.dataTransfer.dropEffect = "copy"
  }

  const onDragLeave = (_event: DragEvent<HTMLDivElement>) => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragging(false)
  }

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragging(false)
    if (overQuota) return
    // event.dataTransfer is only guaranteed valid during the drop tick;
    // capture File references and FileSystemEntry roots synchronously
    // before any await, then walk the entries asynchronously.
    const dtItems = event.dataTransfer.items
    const dtFiles = Array.from(event.dataTransfer.files)
    const entries: FileSystemEntry[] = []
    if (dtItems.length > 0 && typeof (dtItems[0] as DataTransferItem).webkitGetAsEntry === "function") {
      for (const it of Array.from(dtItems)) {
        const entry = (it as unknown as { webkitGetAsEntry: () => FileSystemEntry | null }).webkitGetAsEntry()
        if (entry !== null && entry !== undefined) entries.push(entry)
      }
    }
    if (entries.length > 0) {
      const files = await filesFromEntries(entries)
      if (files.length > 0) transfersApi.enqueue(bucket, prefix, files)

      return
    }
    if (dtFiles.length > 0) transfersApi.enqueue(bucket, prefix, dtFiles)
  }

  const existingFolderNames = useMemo(() => dirs.map((d) => dirName(d)), [dirs])

  // Breadcrumb pieces. prefixToUrlPath percent-encodes each segment so folders
  // containing `?`, `#`, `%`, ".", "..", `\` don't break the URL.
  const segments = prefixToSegments(prefix)
  const bucketRootHref = "/"
  const segHref = (idx: number): string => {
    const upTo = segments.slice(0, idx + 1)

    return `/browse/${prefixToUrlPath(`${upTo.join("/")}/`)}/`
  }
  const dirHref = (dirPrefix: string): string =>
    `/browse/${prefixToUrlPath(dirPrefix)}/`

  // Pending upload resumption. Selecting a matching file plans the resume
  // against SeaweedFS's part list; the transfers layer runs the rest.
  const pendingResumeInputRef = useRef<HTMLInputElement>(null)
  const [pendingResumeTarget, setPendingResumeTarget] = useState<{ key: string; uploadId: string } | null>(null)

  const startResumeForFile = async (file: File) => {
    const target = pendingResumeTarget
    if (target === null) return
    try {
      const parts = await listUploadedParts(s3, bucket, target.key, target.uploadId)
      const planned = planResume({ fileSize: file.size, parts })
      if (!planned.ok) {
        setFlash({ tone: "red", message: t("notice.resumeBlocked", { reason: planned.reason }) })

        return
      }
      transfersApi.resumePending(bucket, target.key, target.uploadId, file)
      setFlash({ tone: "ok", message: t("notice.resumeStarted") })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ tone: "red", message: t("notice.resumeFailed", { message }) })
    } finally {
      setPendingResumeTarget(null)
    }
  }

  const abortPending = async (key: string, uploadId: string) => {
    try {
      await abortPendingUpload(s3, bucket, key, uploadId)
      await queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
      setFlash({ tone: "ok", message: t("notice.discarded") })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ tone: "red", message: t("notice.discardFailed", { message }) })
    }
  }

  const pending = pendingUploads.data ?? []

  return (
    <div className="wrap">
      <NoticeStack>
        {bucketReady.isError && !noticeDismissed.bucket
          ? (
            <Callout
              tone="red"
              role="alert"
              actions={<Button size="sm" onClick={() => void bucketReady.refetch()}>{t("common.retry")}</Button>}
              dismissAriaLabel={t("common.close")}
              onDismiss={() => setNoticeDismissed((d) => ({ ...d, bucket: true }))}
            >
              {t("notice.bucketInitFailed", {
                message: bucketReady.error instanceof Error ? bucketReady.error.message : String(bucketReady.error),
              })}
            </Callout>
          )
          : null}
        {overQuota && !noticeDismissed.quota
          ? (
            <Callout
              tone="red"
              icon="up"
              dismissAriaLabel={t("common.close")}
              onDismiss={() => setNoticeDismissed((d) => ({ ...d, quota: true }))}
            >
              {t("notice.overQuota")}
            </Callout>
          )
          : null}
        {flash !== null
          ? (
            <Callout
              tone={flash.tone}
              role={flash.tone === "red" ? "alert" : "status"}
              dismissAriaLabel={t("common.close")}
              onDismiss={() => setFlash(null)}
            >
              {flash.message}
            </Callout>
          )
          : null}
        {directory.isError && !noticeDismissed.list
          ? (
            <Callout
              tone="red"
              role="alert"
              actions={<Button size="sm" onClick={() => void directory.refetch()}>{t("common.retry")}</Button>}
              dismissAriaLabel={t("common.close")}
              onDismiss={() => setNoticeDismissed((d) => ({ ...d, list: true }))}
            >
              {t("notice.listFailed", {
                message: directory.error instanceof Error ? directory.error.message : String(directory.error),
              })}
            </Callout>
          )
          : null}
      </NoticeStack>

      <div className="pathbar">
        <div className="crumb">
          {segments.length === 0
            ? <span className="cur">{bucket}</span>
            : <Link to={bucketRootHref}>{bucket}</Link>}
          <span className="sl">/</span>
          {segments.map((seg, idx) => {
            const isLast = idx === segments.length - 1

            return (
              <span key={idx} style={{ display: "contents" }}>
                {isLast
                  ? <span className="cur">{seg}</span>
                  : <Link to={segHref(idx)}>{seg}</Link>}
                {isLast ? null : <span className="sl">/</span>}
              </span>
            )
          })}
        </div>
        <div className="actions">
          <Button size="sm" onClick={() => setNewFolderOpen(true)}>{t("browse.newFolder")}</Button>
          <div style={{ position: "relative" }}>
            <Button
              kind="pri"
              size="sm"
              aria-disabled={overQuota ? "true" : undefined}
              onClick={(event) => {
                event.stopPropagation()
                if (overQuota) return
                setUploadMenuOpen((v) => v === "header" ? null : "header")
              }}
              style={overQuota ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            >
              <Icon name="up" size={14} />
              {t("browse.upload")}
              <Icon name="caret" size={10} className="caret" />
            </Button>
            {uploadMenuOpen === "header" ? (
              <div className="uploadmenu" role="menu" onClick={(event) => event.stopPropagation()}>
                <MenuItem onClick={() => { setUploadMenuOpen(null); fileInputRef.current?.click() }}>
                  <Icon name="file" size={15} />
                  {t("browse.chooseFile")}
                </MenuItem>
                <MenuItem onClick={() => { setUploadMenuOpen(null); folderInputRef.current?.click() }}>
                  <Icon name="folder" size={15} />
                  {t("browse.chooseFolder")}
                </MenuItem>
              </div>
            ) : null}
            <HiddenFileInput ref={fileInputRef} onChoose={(files) => onFilesChosen(files)} />
            <HiddenFileInput ref={folderInputRef} onChoose={(files) => onFilesChosen(files)} directory />
          </div>
        </div>
      </div>

      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t("browse.searchPlaceholder")}
          ariaLabel={t("browse.searchPlaceholder")}
        />
        <div className="lens">
          <Chip active={lens === "all"} onClick={() => setLens("all")}>
            {t("browse.lensAll")} <span className="num">{totalCount}</span>
          </Chip>
          <Chip active={lens === "timed"} onClick={() => setLens("timed")}>
            {t("browse.lensTimed")} <span className="num">{presignedCount}</span>
          </Chip>
        </div>
        <div className="right">
          <div className="quota">
            <span>{t("browse.quotaLabel")}</span>
            <div className={cn("bar", { over: overQuota })}>
              <i style={{ width: `${usagePct}%` }} />
            </div>
            <b className={overQuota ? "over" : undefined}>{formatBytes(used, 1)} / {formatBytes(total, 0)}</b>
          </div>
        </div>
      </div>

      {pending.length > 0
        ? (
          <div className="card" style={{ marginBottom: 14 }} data-testid="pending-uploads">
            <div className="bulkbar">
              <b>{t("pendingUploads.title")}</b>
              <span style={{ color: "var(--inkSoft)" }}>{t("pendingUploads.count", { n: pending.length })}</span>
            </div>
            {pending.map((p) => (
              <div className="row nosel" key={`${p.key}::${p.uploadId}`}>
                <div className="c-name">
                  <Icon name="up" size={16} className="ico" />
                  <span className="nm" title={p.key}>{entryName(p.key)}</span>
                </div>
                <div className="c-pub"><span className="dash">—</span></div>
                <div className="c-size">—</div>
                <div className="c-date">—</div>
                <div className="c-act" style={{ display: "flex", gap: 6 }}>
                  <Button
                    kind="po"
                    size="sm"
                    onClick={() => {
                      setPendingResumeTarget({ key: p.key, uploadId: p.uploadId })
                      pendingResumeInputRef.current?.click()
                    }}
                  >
                    {t("pendingUploads.resume")}
                  </Button>
                  <Button kind="stop" size="sm" onClick={() => void abortPending(p.key, p.uploadId)}>
                    {t("pendingUploads.discard")}
                  </Button>
                </div>
              </div>
            ))}
            <HiddenFileInput
              ref={pendingResumeInputRef}
              onChoose={(files) => {
                const f = files.item(0)
                if (f !== null) void startResumeForFile(f)
              }}
            />
          </div>
        )
        : null}

      <div className={cn("card", { menuopen: openRowMenu !== null || openFolderMenu !== null || uploadMenuOpen === "empty" })}>
        {selection.size === 0
          ? null
          : (
            <div className="bulkbar">
              <b>{t("browse.selectedCount", { n: selection.size })}</b>
              <Button kind="ghost" size="sm" onClick={clearSelection}>{t("browse.clearSelection")}</Button>
              <span style={{ marginLeft: "auto" }} />
              <Button kind="po" size="sm" onClick={() => openShare([...selection])}>{t("browse.issueLink")}</Button>
              <Button kind="po" size="sm" onClick={() => void downloadSelection([...selection])}>{t("browse.menuDownloadZip")}</Button>
              <Button kind="do" size="sm" onClick={() => openDelete([...selection])}>{t("common.delete")}</Button>
            </div>
          )}
        <div className="thead sel">
          <span>
            <Checkbox
              checked={rows.length > 0 && selection.size > 0 && selection.size === rows.length}
              onChange={(next) => {
                if (next) setSelection(new Set(rows.map((r) => r.key)))
                else clearSelection()
              }}
              ariaLabel={t("browse.selectAll")}
            />
          </span>
          <SortButton
            active={sort.key === "name"}
            descending={sort.dir === "desc"}
            onClick={() => toggleSort("name")}
          >
            {t("browse.colName")}
          </SortButton>
          <span className="col-center">{t("browse.colShare")}</span>
          <SortButton
            active={sort.key === "size"}
            descending={sort.dir === "desc"}
            align="right"
            onClick={() => toggleSort("size")}
          >
            {t("browse.colSize")}
          </SortButton>
          <SortButton
            active={sort.key === "updated"}
            descending={sort.dir === "desc"}
            align="right"
            onClick={() => toggleSort("updated")}
          >
            {config.fileTtlDays === null ? t("browse.colUpdated") : t("browse.colUpdatedWithTtl")}
          </SortButton>
          <span />
        </div>

        <div
          className={cn("cardbody", { dragging: isDragging && !overQuota })}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={(event) => void onDrop(event)}
        >
          {noResultsAfterSearch
            ? (
              <div className="empty" style={{ padding: "48px 24px" }}>
                <h2 style={{ fontSize: 15 }}>{t("browse.searchNoMatch", { query: search })}</h2>
                <div className="lens" style={{ justifyContent: "center" }}>
                  <Chip onClick={() => setSearch("")}>{t("browse.clearSearch")}</Chip>
                </div>
              </div>
            )
            : noTimedResults
              ? (
                <div className="empty" style={{ padding: "48px 24px" }}>
                  <h2 style={{ fontSize: 15 }}>{t("browse.noTimedLinks")}</h2>
                  <div className="lens" style={{ justifyContent: "center" }}>
                    <Chip onClick={() => setLens("all")}>{t("browse.showAll")}</Chip>
                  </div>
                </div>
              )
              : rows.length === 0 && dirs.length === 0
                ? (
                  <div className="emptyzone">
                    <div className="eico"><Icon name="up" size={24} /></div>
                    <div className="ez-title">{t("browse.emptyTitle")}</div>
                    <div className="ez-note">
                      {t("browse.emptyBodyUpload")}<br />
                      {t("browse.emptyBodyDrop")}
                    </div>
                    <div className="ez-actions">
                      <div style={{ position: "relative" }}>
                        <Button
                          kind="pri"
                          size="sm"
                          disabled={overQuota}
                          onClick={(event) => {
                            event.stopPropagation()
                            setUploadMenuOpen((v) => v === "empty" ? null : "empty")
                          }}
                        >
                          <Icon name="up" size={14} />
                          {t("browse.upload")}
                          <Icon name="caret" size={10} className="caret" />
                        </Button>
                        {uploadMenuOpen === "empty" ? (
                          <div className="uploadmenu uploadmenu-center" role="menu" onClick={(event) => event.stopPropagation()}>
                            <MenuItem onClick={() => { setUploadMenuOpen(null); fileInputRef.current?.click() }}>
                              <Icon name="file" size={15} />
                              {t("browse.chooseFile")}
                            </MenuItem>
                            <MenuItem onClick={() => { setUploadMenuOpen(null); folderInputRef.current?.click() }}>
                              <Icon name="folder" size={15} />
                              {t("browse.chooseFolder")}
                            </MenuItem>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
                : (
                  <>
                    {visibleDirs.map((dirPrefix) => {
                      const name = dirName(dirPrefix)
                      const href = dirHref(dirPrefix)
                      const isFolderMenuOpen = openFolderMenu === dirPrefix
                      const stat = folderStats?.get(dirPrefix)

                      return (
                        <div
                          className="row sel folder-row"
                          key={dirPrefix}
                          onClick={(event) => {
                            const target = event.target as HTMLElement
                            if (target.closest("button, a, input") !== null) return
                            navigate(href)
                          }}
                        >
                          <div className="c-sel" />
                          <div className="c-name">
                            <Icon name="folder" size={20} className="ico f" />
                            <FolderNavButton
                              to={href}
                              onNavigate={(to) => navigate(to)}
                              className="nm folder"
                              title={name}
                            >
                              {name}
                            </FolderNavButton>
                            <span className="opencue" aria-hidden="true">{t("browse.openFolder")}</span>
                            <Icon name="caret" size={12} className="folder-chev" />
                          </div>
                          <div className="c-pub"><span className="dash">—</span></div>
                          <div className="c-size">{stat === undefined ? "—" : formatBytes(stat.bytes)}</div>
                          <div className="c-date">
                            {stat === undefined ? "—" : formatListDateTime(new Date(stat.lastModifiedMs), lang)}
                          </div>
                          <div className="c-act">
                            <IconButton
                              icon="more"
                              ariaLabel={t("browse.rowActions", { name })}
                              active={isFolderMenuOpen}
                              onClick={(event) => {
                                event.stopPropagation()
                                setOpenFolderMenu(isFolderMenuOpen ? null : dirPrefix)
                              }}
                            />
                            {isFolderMenuOpen ? (
                              <div className="rowmenu" role="menu" onClick={(event) => event.stopPropagation()}>
                                <MenuItem onClick={() => { setOpenFolderMenu(null); void downloadFolder(dirPrefix, name) }}>
                                  <Icon name="dl" size={15} />
                                  {t("browse.menuDownloadZip")}
                                </MenuItem>
                                <div className="sepline" />
                                <MenuItem onClick={() => { setOpenFolderMenu(null); setFolderRenameTarget({ prefix: dirPrefix, name }) }}>
                                  {t("browse.menuRename")}
                                </MenuItem>
                                <MenuItem onClick={() => { setOpenFolderMenu(null); setFolderMoveTarget({ prefix: dirPrefix, name }) }}>
                                  {t("browse.menuMove")}
                                </MenuItem>
                                <div className="sepline" />
                                <MenuItem danger onClick={() => { setOpenFolderMenu(null); setFolderDeleteTarget({ prefix: dirPrefix, name }) }}>
                                  <Icon name="trash" size={15} />
                                  {t("browse.menuDelete")}
                                </MenuItem>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}

                    {rows.map((file) => {
                      const key = file.key
                      const name = entryName(key)
                      if (name === ".keep") return null
                      const presigned = presignedByKey.get(key)
                      const isSelected = selection.has(key)
                      const isMenuOpen = openRowMenu === key
                      const canExpand = presigned !== undefined
                      const isExpanded = canExpand && expandedRows.has(key)
                      const rowClass = cn("row sel", {
                        selected: isSelected,
                        presigned: canExpand && !isSelected && isExpanded,
                        expandable: canExpand,
                        expanded: isExpanded,
                      })

                      return (
                        <Fragment key={key}>
                          <div
                            className={rowClass}
                            onClick={canExpand ? (event) => onRowActivate(event, key) : undefined}
                            aria-expanded={canExpand ? isExpanded : undefined}
                          >
                            <div className="c-sel">
                              <Checkbox checked={isSelected} onChange={() => toggleSelection(key)} ariaLabel={t("browse.selectRow", { name })} />
                            </div>
                            <div className="c-name">
                              <Icon name="file" size={20} className="ico" />
                              <span className="nm" title={key}>{name}</span>
                              {canExpand ? (
                                <>
                                  <span className="opencue" aria-hidden="true">{t("browse.openUrl")}</span>
                                  <Icon name="caret" size={12} className="row-chev" />
                                </>
                              ) : null}
                            </div>
                            <div className="c-pub">
                              {presigned === undefined
                                ? <span className="dash">—</span>
                                : <Tag tone="warn"><Icon name="clock" size={11} />{t("browse.timedTag")}</Tag>}
                            </div>
                            <div className="c-size">{file.size === undefined ? "—" : formatBytes(file.size)}</div>
                            <div className="c-date">
                              <div>{formatListDateTime(file.lastModified, lang)}</div>
                              {config.fileTtlDays === null
                                ? null
                                : (
                                  <div style={{ fontSize: 11, color: "var(--inkSoft)" }}>
                                    <TtlExpiry createdMs={file.lastModified.getTime()} ttlDays={config.fileTtlDays} />
                                  </div>
                                )}
                            </div>
                            <div className="c-act">
                              <Button kind="po" size="sm" className="pubbtn" onClick={() => openShare([key])}>{t("browse.issueLink")}</Button>
                              <IconButton
                                icon="more"
                                ariaLabel={t("browse.rowActions", { name })}
                                active={isMenuOpen}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setOpenRowMenu(isMenuOpen ? null : key)
                                }}
                              />
                              {isMenuOpen ? (
                                <div className="rowmenu" role="menu" onClick={(event) => event.stopPropagation()}>
                                  {canExpand ? (
                                    <MenuItem onClick={() => { setOpenRowMenu(null); void copyShareUrl(key) }}>
                                      <Icon name="link" size={15} />
                                      {t("browse.menuCopyLink")}
                                    </MenuItem>
                                  ) : null}
                                  <MenuItem onClick={() => { setOpenRowMenu(null); void download(key) }}>
                                    <Icon name="dl" size={15} />
                                    {t("browse.menuDownload")}
                                  </MenuItem>
                                  <div className="sepline" />
                                  <MenuItem onClick={() => { setOpenRowMenu(null); setRenameTarget(key) }}>
                                    {t("browse.menuRename")}
                                  </MenuItem>
                                  <MenuItem onClick={() => { setOpenRowMenu(null); setMoveTarget(key) }}>
                                    {t("browse.menuMove")}
                                  </MenuItem>
                                  <MenuItem onClick={() => { setOpenRowMenu(null); setCopyTarget(key) }}>
                                    {t("browse.menuCopy")}
                                  </MenuItem>
                                  <div className="sepline" />
                                  <MenuItem danger onClick={() => { setOpenRowMenu(null); openDelete([key]) }}>
                                    <Icon name="trash" size={15} />
                                    {t("browse.menuDelete")}
                                  </MenuItem>
                                </div>
                              ) : null}
                            </div>
                          </div>
                          {presigned !== undefined && isExpanded ? (
                            <div className="presignpanel">
                              <div className="pp-top">
                                <span className="lbl" style={{ color: "var(--warnFg)" }}>
                                  <PresignExpiryLabel expiresAtMs={presigned.expiresAt} />
                                </span>
                              </div>
                              <LinkBar url={presigned.url} tone="warn" copyLabel={t("common.copy")} copiedLabel={t("common.copied")} />
                            </div>
                          ) : null}
                        </Fragment>
                      )
                    })}
                  </>
                )}
          {isDragging && !overQuota ? (
            <div className="dropov" aria-hidden="true">
              <Icon name="up" size={28} />
              <div className="t">{t("browse.dropHint")}</div>
            </div>
          ) : null}
        </div>
      </div>

      <UploadCard
        transfers={transfersApi.transfers}
        onCancelAll={transfersApi.cancelAll}
        onCancel={transfersApi.cancel}
        onRetry={transfersApi.retry}
        onOverwrite={transfersApi.overwrite}
        onSaveAs={transfersApi.saveAs}
        onSkip={transfersApi.skip}
        onDismissAll={transfersApi.dismissAll}
        onDismissDone={transfersApi.dismissDone}
      />

      <ShareModal
        open={share !== null}
        onClose={() => {
          setShare(null)
          // A new presigned URL is only observable in the row via
          // presignedList; addSessionPresigned writes to sessionStorage which
          // React does not observe, so nudge the memo here.
          setPresignedTick((v) => v + 1)
        }}
        targets={share ?? []}
      />

      <DeleteModal
        open={deleteTargets !== null}
        onClose={() => setDeleteTargets(null)}
        targets={deleteTargets ?? []}
        onConfirm={() => {
          const targets = deleteTargets
          if (targets === null) return
          void transfersApi
            .enqueueDelete(bucket, targets.map((x) => ({ key: x.key, size: x.size })))
            .then((res) => {
              setSelection((prev) => {
                const next = new Set(prev)
                for (const k of res.ok) next.delete(k)

                return next
              })
            })
        }}
      />

      {renameTarget !== null ? (
        <RenameModal
          open
          onClose={() => setRenameTarget(null)}
          bucket={bucket}
          srcKey={renameTarget}
          siblingNames={files.map((f) => entryName(f.key)).filter((n) => n !== entryName(renameTarget))}
          onConfirm={(destKey) => {
            const src = renameTarget
            if (src === null) return
            void transfersApi.enqueueRename(bucket, src, destKey).catch(() => undefined)
          }}
        />
      ) : null}

      {moveTarget !== null ? (
        <MoveModal
          open
          onClose={() => setMoveTarget(null)}
          bucket={bucket}
          srcKey={moveTarget}
          onConfirm={(destKey) => {
            const src = moveTarget
            if (src === null) return
            void transfersApi.enqueueMove(bucket, src, destKey).catch(() => undefined)
          }}
        />
      ) : null}

      {copyTarget !== null ? (
        <CopyModal
          open
          onClose={() => setCopyTarget(null)}
          bucket={bucket}
          srcKey={copyTarget}
          siblingNames={files.map((f) => entryName(f.key))}
          onConfirm={(destKey) => {
            const src = copyTarget
            if (src === null) return
            void transfersApi.enqueueCopy(bucket, src, destKey).catch(() => undefined)
          }}
        />
      ) : null}

      {folderDeleteTarget !== null ? (
        <FolderDeleteModal
          open
          onClose={() => setFolderDeleteTarget(null)}
          folderName={folderDeleteTarget.name}
          onConfirm={() => {
            const target = folderDeleteTarget
            if (target === null) return
            void transfersApi.enqueueFolderDelete(bucket, target.prefix)
          }}
        />
      ) : null}

      {folderRenameTarget !== null ? (
        <FolderRenameModal
          open
          onClose={() => setFolderRenameTarget(null)}
          currentName={folderRenameTarget.name}
          siblingNames={dirs.map((d) => dirName(d)).filter((n) => n !== folderRenameTarget.name)}
          onConfirm={(newName) => {
            const target = folderRenameTarget
            if (target === null) return
            const parentPrefixOfTarget = target.prefix.slice(0, target.prefix.length - target.name.length - 1)
            const dest = `${parentPrefixOfTarget}${newName}/`
            void transfersApi.enqueueFolderMove(bucket, target.prefix, dest, "folder-rename")
          }}
        />
      ) : null}

      {folderMoveTarget !== null ? (
        <FolderMoveModal
          open
          onClose={() => setFolderMoveTarget(null)}
          bucket={bucket}
          srcPrefix={folderMoveTarget.prefix}
          onConfirm={(destParent) => {
            const target = folderMoveTarget
            if (target === null) return
            const dest = `${destParent}${target.name}/`
            void transfersApi.enqueueFolderMove(bucket, target.prefix, dest, "folder-move")
          }}
        />
      ) : null}

      <NewFolderModal
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        bucket={bucket}
        prefix={prefix}
        existingNames={existingFolderNames}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["objects", bucket, prefix] })}
      />

      {/* Reserve room below the card for row menus that overflow the card edge. */}
      <div aria-hidden="true" style={{ height: 190 }} />
    </div>
  )
}

// Recursive walk over a DataTransferItemList (drag-and-drop). Each dropped
// entry is either a File or a directory to enumerate; every reconstructed
// `File` carries a `webkitRelativePath` so callers can preserve the folder
// structure when computing S3 keys. Browsers without the non-standard
// `webkitGetAsEntry` fall through to the caller's non-directory path.
type FileSystemEntry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath: string
  file?: (cb: (file: File) => void, err: (e: unknown) => void) => void
  createReader?: () => FileSystemDirectoryReader
}

type FileSystemDirectoryReader = {
  readEntries: (cb: (entries: FileSystemEntry[]) => void, err: (e: unknown) => void) => void
}

const filesFromEntries = async (roots: FileSystemEntry[]): Promise<File[]> => {
  const out: File[] = []
  await Promise.all(roots.map((root) => walkEntry(root, "", out)))

  return out
}

const walkEntry = async (entry: FileSystemEntry, parentPath: string, out: File[]): Promise<void> => {
  // Native FileSystemFileEntry.file() checks `this` internally, so a detached
  // reference (`const f = entry.file; f(...)`) throws "Illegal invocation".
  // Rebind via .call(entry, …) instead of a member-call expression to keep
  // the pattern local (rather than repeat the .file? undefined check).
  const readFile = entry.file
  if (entry.isFile && readFile !== undefined) {
    const file = await new Promise<File | null>((resolve) => {
      readFile.call(entry, resolve, () => resolve(null))
    })
    if (file === null) return
    const rel = `${parentPath}${entry.name}`
    // Overwrite webkitRelativePath so callers see the drop path, not "" (which
    // is what a plain File has). Object.defineProperty because the property
    // is read-only on File.
    try {
      Object.defineProperty(file, "webkitRelativePath", { value: rel, configurable: true })
    } catch {
      // ignore — some engines refuse to redefine; the file still uploads to
      // its own name.
    }
    out.push(file)

    return
  }
  if (entry.isDirectory && entry.createReader !== undefined) {
    const reader = entry.createReader()
    const readAll = async (): Promise<FileSystemEntry[]> => {
      const all: FileSystemEntry[] = []
      for (;;) {
        const chunk = await new Promise<FileSystemEntry[]>((resolve) => {
          reader.readEntries((entries) => resolve(entries), () => resolve([]))
        })
        if (chunk.length === 0) break
        for (const e of chunk) all.push(e)
      }

      return all
    }
    const children = await readAll()
    const nextParent = `${parentPath}${entry.name}/`
    await Promise.all(children.map((child) => walkEntry(child, nextParent, out)))
  }
}
