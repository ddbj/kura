import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { DragEvent, MouseEvent as ReactMouseEvent } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "react-oidc-context"
import { Link, useNavigate } from "react-router"

import { usernameFromAccessToken } from "~/lib/auth/token"
import { useConfig } from "~/lib/config"
import { formatBytes } from "~/lib/format"
import {
  abortPendingUpload,
  applyPublicState,
  beginPublicStateChange,
  DEFAULT_QUOTA_BYTES,
  dirName,
  ensureOwnBucket,
  entryName,
  isUsableBucketName,
  listBucketTotalBytes,
  listDirectory,
  listPendingUploads,
  listUploadedParts,
  planResume,
  prefixToSegments,
  prefixToUrlPath,
  presignDownloadUrl,
  publicUrl,
  revertPublicStateOnFailure,
  unpublishObject,
  useObjectPublicFlags,
} from "~/lib/s3"
import { useS3 } from "~/lib/s3/use-s3"
import { listSessionPresigned, type SessionPresigned } from "~/lib/session-presigned"
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
// dedicated login screen (frame 10), not the default plain button.
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
type Lens = "all" | "public" | "timed"

const formatShortDate = (d: Date): string => {
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")

  return `${mm}/${dd}`
}

// One shared ticker at page level drives every "残り N 分" / "あと N 日" cell,
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
const ExpiresInMinutes = ({ expiresAtMs }: { expiresAtMs: number }) => {
  const nowMs = useNow() ?? expiresAtMs

  return <>{Math.max(0, Math.round((expiresAtMs - nowMs) / 60000))}</>
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

const TtlExpiry = ({ createdMs, ttlDays }: { createdMs: number; ttlDays: number }) => {
  const nowMs = useNow()
  const expiresMs = createdMs + ttlDays * MS_PER_DAY
  if (nowMs === null) return null
  const remainingDays = Math.max(0, Math.ceil((expiresMs - nowMs) / MS_PER_DAY))

  return <>あと {remainingDays} 日</>
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
    queryFn: () => listBucketTotalBytes(s3, bucket),
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
  const fileKeys = useMemo(() => files.map((f) => f.key), [files])
  const publicFlags = useObjectPublicFlags(s3, bucket, fileKeys)

  // Session-local presigned URL log fuels the "期限つき" lens (design_handoff #1).
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
  const presignedList = useMemo<SessionPresigned[]>(
    () => listSessionPresigned(bucket),
    // presignedTick + bucket both invalidate the memo when a refresh is due.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucket, presignedTick, transfersApi.transfers.length],
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
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false)
  const [share, setShare] = useState<
    | { targets: { bucket: string; key: string; name: string; size: number }[]; mode: "pub" | "temp" }
    | null
  >(null)
  const [deleteTargets, setDeleteTargets] = useState<{ bucket: string; key: string; name: string; size: number; isPublic?: boolean }[] | null>(null)
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

  const closeAllMenus = useCallback(() => {
    setOpenRowMenu(null)
    setUploadMenuOpen(false)
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
    const t = setTimeout(() => document.addEventListener("click", onClick), 0)

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
      clearTimeout(t)
      document.removeEventListener("click", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [openRowMenu, uploadMenuOpen, openFolderMenu, closeAllMenus])

  const used = usage.data ?? 0
  const total = DEFAULT_QUOTA_BYTES
  const overQuota = used >= total
  const usagePct = Math.min(100, (used / total) * 100)

  const rows = useMemo(() => {
    const filtered = files.filter((f) => {
      const name = entryName(f.key).toLowerCase()
      if (search !== "" && !name.includes(search.toLowerCase())) return false
      const isPub = publicFlags.get(f.key) === true
      const isPres = presignedByKey.has(f.key)
      if (lens === "public" && !isPub) return false
      if (lens === "timed" && !isPres) return false

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
  }, [files, publicFlags, presignedByKey, search, lens, sort])

  const publicCount = files.filter((f) => publicFlags.get(f.key) === true).length
  const presignedCount = presignedList.length
  const totalCount = files.length + dirs.length

  const anyRowInPrefix = totalCount > 0
  const noResultsAfterSearch = search !== "" && rows.length === 0 && anyRowInPrefix

  const toggleSort = (key: SortKey) => {
    setSort((prev) => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" })
  }

  const clearSelection = () => setSelection(new Set())

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

  // Row click toggles the pubpanel / presignpanel, but never when the user
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
      setFlash({ tone: "red", message: `ダウンロードに失敗しました: ${message}` })
    }
  }

  const unpublish = useMutation({
    mutationFn: async (key: string) => {
      const changeToken = beginPublicStateChange(bucket, key)
      try {
        await unpublishObject(s3, bucket, key)
        await applyPublicState(queryClient, bucket, key, false, changeToken)
      } catch (err) {
        await revertPublicStateOnFailure(queryClient, bucket, key, changeToken)
        throw err
      }
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ tone: "red", message: `公開停止に失敗しました: ${message}` })
    },
  })

  const openShare = (keys: string[], mode: "pub" | "temp" = "pub") => {
    const targets = keys.flatMap<{ bucket: string; key: string; name: string; size: number }>((k) => {
      const f = files.find((x) => x.key === k)
      if (f === undefined) return []

      return [{ bucket, key: f.key, name: entryName(f.key), size: f.size ?? 0 }]
    })
    if (targets.length === 0) return
    setShare({ targets, mode })
  }

  const openDelete = (keys: string[]) => {
    const targets = keys.flatMap<{ bucket: string; key: string; name: string; size: number; isPublic?: boolean }>((k) => {
      const f = files.find((x) => x.key === k)
      if (f === undefined) return []

      return [{ bucket, key: f.key, name: entryName(f.key), size: f.size ?? 0, isPublic: publicFlags.get(k) === true }]
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

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (overQuota) return
    const items = event.dataTransfer.items
    if (items.length > 0 && typeof (items[0] as DataTransferItem).webkitGetAsEntry === "function") {
      // Directory-capable path: walk each dragged entry and reconstruct File
      // objects with a `webkitRelativePath` so the transfer preserves the
      // dropped folder structure.
      const files = await filesFromDataTransferItems(items)
      if (files.length > 0) transfersApi.enqueue(bucket, prefix, files)

      return
    }
    const arr: File[] = []
    for (const item of Array.from(event.dataTransfer.files)) arr.push(item)
    if (arr.length > 0) transfersApi.enqueue(bucket, prefix, arr)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (overQuota) return
    setIsDragging(true)
  }

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) setIsDragging(false)
  }

  const existingFolderNames = useMemo(() => dirs.map((d) => dirName(d)), [dirs])

  // Breadcrumb pieces. prefixToUrlPath percent-encodes each segment so folders
  // containing `?`, `#`, `%`, ".", "..", `\` don't break the URL.
  const segments = prefixToSegments(prefix)
  const bucketRootHref = "/"
  const segHref = (idx: number): string => {
    const upTo = segments.slice(0, idx + 1)

    return `/_browse/${prefixToUrlPath(`${upTo.join("/")}/`)}/`
  }
  const dirHref = (dirPrefix: string): string =>
    `/_browse/${prefixToUrlPath(dirPrefix)}/`

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
        setFlash({ tone: "red", message: `再開できません: ${planned.reason}` })

        return
      }
      transfersApi.resumePending(bucket, target.key, target.uploadId, file)
      setFlash({ tone: "ok", message: "再開を開始しました" })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ tone: "red", message: `再開に失敗しました: ${message}` })
    } finally {
      setPendingResumeTarget(null)
    }
  }

  const abortPending = async (key: string, uploadId: string) => {
    try {
      await abortPendingUpload(s3, bucket, key, uploadId)
      await queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
      setFlash({ tone: "ok", message: "破棄しました" })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ tone: "red", message: `破棄に失敗しました: ${message}` })
    }
  }

  const pending = pendingUploads.data ?? []

  return (
    <div
      className="wrap"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(event) => void onDrop(event)}
    >
      {bucketReady.isError
        ? (
          <div style={{ margin: "24px 0 0" }}>
            <Callout tone="red" role="alert">
              <div>
                領域の初期化に失敗しました: {bucketReady.error instanceof Error ? bucketReady.error.message : String(bucketReady.error)}
              </div>
              <div style={{ marginTop: 8 }}>
                <Button size="sm" onClick={() => void bucketReady.refetch()}>再試行</Button>
              </div>
            </Callout>
          </div>
        )
        : null}

      {overQuota
        ? (
          <div className="banner red" style={{ margin: "24px 0 0", alignItems: "center" }}>
            <Icon name="up" size={16} style={{ color: "var(--red)", flex: "none", marginTop: 1 }} />
            <div>容量が上限に達しています。新規アップロードは停止中です。ファイルを削除して空き容量ができれば自動的に再開します。ダウンロード・削除は引き続き行えます。</div>
          </div>
        )
        : null}

      {flash !== null
        ? (
          <div style={{ margin: "16px 0 0" }}>
            <Callout tone={flash.tone} role={flash.tone === "red" ? "alert" : "status"}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1 }}>{flash.message}</span>
                <Button kind="ghost" size="sm" onClick={() => setFlash(null)}>閉じる</Button>
              </div>
            </Callout>
          </div>
        )
        : null}

      <div className="pathbar" style={overQuota ? { paddingTop: 12 } : undefined}>
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
          <Button size="sm" onClick={() => setNewFolderOpen(true)}>＋ 新規フォルダ</Button>
          <div style={{ position: "relative" }}>
            <Button
              kind="pri"
              size="sm"
              aria-disabled={overQuota ? "true" : undefined}
              onClick={(event) => {
                event.stopPropagation()
                if (overQuota) return
                setUploadMenuOpen((v) => !v)
              }}
              style={overQuota ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            >
              <Icon name="up" size={14} />
              アップロード
              <Icon name="caret" size={10} className="caret" />
            </Button>
            {uploadMenuOpen ? (
              <div className="uploadmenu" role="menu" onClick={(event) => event.stopPropagation()}>
                <MenuItem onClick={() => { setUploadMenuOpen(false); fileInputRef.current?.click() }}>
                  <Icon name="file" size={15} />
                  ファイルを選択
                </MenuItem>
                <MenuItem onClick={() => { setUploadMenuOpen(false); folderInputRef.current?.click() }}>
                  <Icon name="folder" size={15} />
                  フォルダを選択
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
          placeholder="ファイル名で絞り込み"
          ariaLabel="ファイル名で絞り込み"
        />
        <div className="lens">
          <Chip active={lens === "all"} onClick={() => setLens("all")}>
            すべて <span className="num">{totalCount}</span>
          </Chip>
          <Chip active={lens === "public"} onClick={() => setLens("public")}>
            公開中 <span className="num">{publicCount}</span>
          </Chip>
          <Chip active={lens === "timed"} onClick={() => setLens("timed")}>
            期限つき <span className="num">{presignedCount}</span>
          </Chip>
        </div>
        <div className="right">
          <div className="quota">
            <span>使用量</span>
            <div className={cn("bar", { over: overQuota })}>
              <i style={{ width: `${usagePct}%` }} />
            </div>
            <b className={overQuota ? "over" : undefined}>{formatBytes(used, 1)} / {formatBytes(total, 0)}</b>
          </div>
        </div>
      </div>

      {directory.isError
        ? (
          <Callout tone="red" role="alert">
            一覧の取得に失敗しました: {directory.error instanceof Error ? directory.error.message : String(directory.error)}
          </Callout>
        )
        : null}

      {pending.length > 0
        ? (
          <div className="card" style={{ marginBottom: 14 }} data-testid="pending-uploads">
            <div className="bulkbar">
              <b>再開待ちのアップロード</b>
              <span style={{ color: "var(--inkSoft)" }}>{pending.length}件</span>
            </div>
            {pending.map((p) => (
              <div className="row nosel" key={`${p.key}::${p.uploadId}`}>
                <div className="c-name">
                  <Icon name="up" size={16} className="ico" />
                  <span className="nm" title={p.key}>{entryName(p.key)}</span>
                </div>
                <div className="c-pub" />
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
                    再開
                  </Button>
                  <Button kind="stop" size="sm" onClick={() => void abortPending(p.key, p.uploadId)}>
                    破棄
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

      <div className={cn("card", { menuopen: openRowMenu !== null })}>
        {selection.size === 0
          ? null
          : (
            <div className="bulkbar">
              <b>{selection.size}件を選択中</b>
              <Button kind="ghost" size="sm" onClick={clearSelection}>選択解除</Button>
              <span style={{ marginLeft: "auto" }} />
              <Button kind="po" size="sm" onClick={() => openShare([...selection])}>公開する</Button>
              <Button kind="do" size="sm" onClick={() => openDelete([...selection])}>削除</Button>
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
              ariaLabel="全選択"
            />
          </span>
          <SortButton
            active={sort.key === "name"}
            descending={sort.dir === "desc"}
            onClick={() => toggleSort("name")}
          >
            名前
          </SortButton>
          <span>共有</span>
          <SortButton
            active={sort.key === "size"}
            descending={sort.dir === "desc"}
            align="right"
            onClick={() => toggleSort("size")}
          >
            サイズ
          </SortButton>
          <SortButton
            active={sort.key === "updated"}
            descending={sort.dir === "desc"}
            align="right"
            onClick={() => toggleSort("updated")}
          >
            更新日{config.fileTtlDays === null ? "" : " / 期限"}
          </SortButton>
          <span />
        </div>

        {noResultsAfterSearch
          ? (
            <div className="empty" style={{ padding: "48px 24px" }}>
              <h2 style={{ fontSize: 15 }}>「{search}」に一致するファイルはありません</h2>
              <div className="lens" style={{ justifyContent: "center" }}>
                <Chip onClick={() => setSearch("")}>検索をクリア</Chip>
              </div>
            </div>
          )
          : rows.length === 0 && dirs.length === 0
            ? (
              <div className="emptyzone">
                <div className="eico"><Icon name="up" size={24} /></div>
                <div className="ez-title">まだファイルがありません</div>
                <div className="ez-note">
                  ファイル・フォルダをアップロードするとここに一覧表示されます。<br />
                  ドラッグ＆ドロップもできます。
                </div>
                <div className="ez-actions">
                  <Button
                    kind="pri"
                    size="sm"
                    disabled={overQuota}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Icon name="up" size={14} />
                    アップロード
                    <Icon name="caret" size={10} className="caret" />
                  </Button>
                </div>
              </div>
            )
            : (
              <>
                {dirs.filter((d) => search === "" || dirName(d).toLowerCase().includes(search.toLowerCase())).map((dirPrefix) => {
                  const name = dirName(dirPrefix)
                  const href = dirHref(dirPrefix)
                  const isFolderMenuOpen = openFolderMenu === dirPrefix

                  return (
                    <div className="row sel" key={dirPrefix}>
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
                      </div>
                      <div className="c-pub" />
                      <div className="c-size">—</div>
                      <div className="c-date">—</div>
                      <div className="c-act">
                        <IconButton
                          icon="more"
                          ariaLabel={`${name} の操作`}
                          active={isFolderMenuOpen}
                          onClick={(event) => {
                            event.stopPropagation()
                            setOpenFolderMenu(isFolderMenuOpen ? null : dirPrefix)
                          }}
                        />
                        {isFolderMenuOpen ? (
                          <div className="rowmenu" role="menu" onClick={(event) => event.stopPropagation()}>
                            <MenuItem onClick={() => { setOpenFolderMenu(null); setFolderRenameTarget({ prefix: dirPrefix, name }) }}>
                              名前を変更
                            </MenuItem>
                            <MenuItem onClick={() => { setOpenFolderMenu(null); setFolderMoveTarget({ prefix: dirPrefix, name }) }}>
                              移動
                            </MenuItem>
                            <div className="sepline" />
                            <MenuItem danger onClick={() => { setOpenFolderMenu(null); setFolderDeleteTarget({ prefix: dirPrefix, name }) }}>
                              <Icon name="trash" size={15} />
                              削除
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
                  const isPub = publicFlags.get(key) === true
                  const presigned = presignedByKey.get(key)
                  const isSelected = selection.has(key)
                  const isMenuOpen = openRowMenu === key
                  const canExpand = isPub || presigned !== undefined
                  const isExpanded = canExpand && expandedRows.has(key)
                  const rowClass = cn("row sel", {
                    selected: isSelected,
                    public: isPub && !isSelected && isExpanded,
                    presigned: !isPub && presigned !== undefined && !isSelected && isExpanded,
                    expandable: canExpand,
                    expanded: isExpanded,
                  })

                  return (
                    <div key={key}>
                      <div
                        className={rowClass}
                        onClick={canExpand ? (event) => onRowActivate(event, key) : undefined}
                        aria-expanded={canExpand ? isExpanded : undefined}
                      >
                        <div className="c-sel">
                          <Checkbox checked={isSelected} onChange={() => toggleSelection(key)} ariaLabel={`${name} を選択`} />
                        </div>
                        <div className="c-name">
                          <Icon name="file" size={20} className="ico" />
                          <span className="nm" title={key}>{name}</span>
                        </div>
                        <div className="c-pub">
                          {isPub
                            ? <Tag tone="ok" dot>公開中</Tag>
                            : presigned !== undefined
                              ? <Tag tone="warn"><Icon name="clock" size={11} />期限つき</Tag>
                              : null}
                        </div>
                        <div className="c-size">{file.size === undefined ? "—" : formatBytes(file.size)}</div>
                        <div className="c-date">
                          <div>{formatShortDate(file.lastModified)}</div>
                          {config.fileTtlDays === null
                            ? null
                            : (
                              <div style={{ fontSize: 11, color: "var(--inkSoft)" }}>
                                <TtlExpiry createdMs={file.lastModified.getTime()} ttlDays={config.fileTtlDays} />
                              </div>
                            )}
                        </div>
                        <div className="c-act">
                          {isPub
                            ? (
                              <Button kind="stop" size="sm" className="pubbtn" onClick={() => unpublish.mutate(key)}>
                                公開を停止
                              </Button>
                            )
                            : <Button kind="po" size="sm" className="pubbtn" onClick={() => openShare([key])}>公開する</Button>}
                          <IconButton
                            icon="more"
                            ariaLabel={`${name} の操作`}
                            active={isMenuOpen}
                            onClick={(event) => {
                              event.stopPropagation()
                              setOpenRowMenu(isMenuOpen ? null : key)
                            }}
                          />
                          {isMenuOpen ? (
                            <div className="rowmenu" role="menu" onClick={(event) => event.stopPropagation()}>
                              <MenuItem onClick={() => { setOpenRowMenu(null); void download(key) }}>
                                <Icon name="dl" size={15} />
                                ダウンロード
                              </MenuItem>
                              <div className="sepline" />
                              <MenuItem onClick={() => { setOpenRowMenu(null); setRenameTarget(key) }}>
                                名前を変更
                              </MenuItem>
                              <MenuItem onClick={() => { setOpenRowMenu(null); setMoveTarget(key) }}>
                                移動
                              </MenuItem>
                              <MenuItem onClick={() => { setOpenRowMenu(null); setCopyTarget(key) }}>
                                コピー
                              </MenuItem>
                              <div className="sepline" />
                              <MenuItem danger onClick={() => { setOpenRowMenu(null); openDelete([key]) }}>
                                <Icon name="trash" size={15} />
                                削除
                              </MenuItem>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {isPub && isExpanded ? (
                        <div className="pubpanel">
                          <div className="pp-top">
                            <span className="lbl">公開URL — 認証なしで誰でもダウンロードできます</span>
                          </div>
                          <LinkBar url={publicUrl(config.publicBase, bucket, key)} tone="ok" copyLabel="コピー" copiedLabel="コピー済み" />
                        </div>
                      ) : null}
                      {presigned !== undefined && !isPub && isExpanded ? (
                        <div className="presignpanel">
                          <div className="pp-top">
                            <span className="lbl" style={{ color: "var(--warnFg)" }}>
                              期限つきリンク — 約<ExpiresInMinutes expiresAtMs={presigned.expiresAt} />分後に自動で失効します
                            </span>
                          </div>
                          <LinkBar url={presigned.url} tone="warn" copyLabel="コピー" copiedLabel="コピー済み" />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </>
            )}
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
      />

      {isDragging && !overQuota ? (
        <div className="dropov" aria-hidden="true">
          <Icon name="up" size={28} />
          <div className="t">ここにドロップしてアップロード</div>
          <div className="sub">現在の {segments.length === 0 ? "ホーム" : segments.join(" / ")} に追加されます</div>
        </div>
      ) : null}

      <ShareModal
        open={share !== null}
        onClose={() => {
          setShare(null)
          // A new presigned URL is only observable in the row via
          // presignedList; addSessionPresigned writes to sessionStorage which
          // React does not observe, so nudge the memo here.
          setPresignedTick((v) => v + 1)
        }}
        targets={share?.targets ?? []}
        initialMode={share?.mode ?? "pub"}
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

      {/* Reserve room below the card for row menus that overflow the card edge (design_handoff #1 uses height:190px). */}
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

const filesFromDataTransferItems = async (items: DataTransferItemList): Promise<File[]> => {
  const roots: FileSystemEntry[] = []
  for (const it of Array.from(items)) {
    // webkitGetAsEntry is non-standard; typed defensively.
    const entry = (it as unknown as { webkitGetAsEntry: () => FileSystemEntry | null }).webkitGetAsEntry()
    if (entry !== null && entry !== undefined) roots.push(entry)
  }
  const out: File[] = []
  await Promise.all(roots.map((root) => walkEntry(root, "", out)))

  return out
}

const walkEntry = async (entry: FileSystemEntry, parentPath: string, out: File[]): Promise<void> => {
  const readFile = entry.file
  if (entry.isFile && readFile !== undefined) {
    const file = await new Promise<File | null>((resolve) => {
      readFile(resolve, () => resolve(null))
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
