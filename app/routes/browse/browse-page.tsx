import { PutObjectCommand } from "@aws-sdk/client-s3"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { DragEvent } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "react-oidc-context"
import { Link, useNavigate } from "react-router"

import { usernameFromAccessToken } from "~/lib/auth/token"
import { useConfig } from "~/lib/config"
import {
  applyPublicState,
  beginPublicStateChange,
  DEFAULT_QUOTA_BYTES,
  dirName,
  ensureOwnBucket,
  entryName,
  isUsableBucketName,
  listBucketTotalBytes,
  listDirectory,
  prefixToSegments,
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

import { DeleteModal } from "./delete-modal"
import { LoginBox } from "./login"
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

const formatBytes = (n: number, digits = 1): string => {
  if (n < 1024) return `${n} B`
  const k = n / 1024
  if (k < 1024) return `${k.toFixed(k < 10 ? digits : 0)} KB`
  const m = k / 1024
  if (m < 1024) return `${m.toFixed(m < 10 ? digits : 0)} MB`
  const g = m / 1024
  if (g < 1024) return `${g.toFixed(g < 10 ? digits : 0)} GB`
  const tt = g / 1024

  return `${tt.toFixed(digits < 2 ? digits : 2)} TB`
}

const formatShortDate = (d: Date): string => {
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")

  return `${mm}/${dd}`
}

const Browse = ({ bucket, prefix }: { bucket: string; prefix: string }) => {
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

  const files = useMemo(() => directory.data?.files ?? [], [directory.data?.files])
  const dirs = useMemo(() => directory.data?.dirs ?? [], [directory.data?.dirs])
  const fileKeys = useMemo(() => files.map((f) => f.key), [files])
  const publicFlags = useObjectPublicFlags(s3, bucket, fileKeys)

  // Session-local presigned URL log fuels the "期限つき" lens (design_handoff #1).
  const [presignedTick, setPresignedTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setPresignedTick((v) => v + 1), 30_000)

    return () => clearInterval(id)
  }, [])
  const presignedList = useMemo<SessionPresigned[]>(
    () => listSessionPresigned(bucket),
    // presignedTick + bucket both invalidate the memo when a refresh is due.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucket, presignedTick, transfersApi.transfers.length],
  )
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

  // Row-menu / user-menu close on outside click
  useEffect(() => {
    if (openRowMenu === null && !uploadMenuOpen) return
    const onClick = () => {
      setOpenRowMenu(null)
      setUploadMenuOpen(false)
    }
    // Delay so the click that opened doesn't close instantly.
    const t = setTimeout(() => document.addEventListener("click", onClick), 0)

    return () => {
      clearTimeout(t)
      document.removeEventListener("click", onClick)
    }
  }, [openRowMenu, uploadMenuOpen])

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
          ? a.size - b.size
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

  const download = async (key: string) => {
    try {
      const url = await presignDownloadUrl(s3, bucket, key)
      window.location.assign(url)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("download failed", err)
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
  })

  const openShare = (keys: string[], mode: "pub" | "temp" = "pub") => {
    const targets = keys.flatMap<{ bucket: string; key: string; name: string; size: number }>((k) => {
      const f = files.find((x) => x.key === k)
      if (f === undefined) return []

      return [{ bucket, key: f.key, name: entryName(f.key), size: f.size }]
    })
    if (targets.length === 0) return
    setShare({ targets, mode })
  }

  const openDelete = (keys: string[]) => {
    const targets = keys.flatMap<{ bucket: string; key: string; name: string; size: number; isPublic?: boolean }>((k) => {
      const f = files.find((x) => x.key === k)
      if (f === undefined) return []

      return [{ bucket, key: f.key, name: entryName(f.key), size: f.size, isPublic: publicFlags.get(k) === true }]
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

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (overQuota) return
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

  const createFolder = async () => {
    const name = window.prompt("新しいフォルダの名前")
    if (name === null || name.trim() === "") return
    // Spec-defined placeholder — architecture.md § 配置 (rewrite-plan.md footnote).
    const key = `${prefix}${name.trim()}/.keep`
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: new Uint8Array(0) }))
    await queryClient.invalidateQueries({ queryKey: ["objects", bucket, prefix] })
  }

  // Breadcrumb pieces
  const segments = prefixToSegments(prefix)
  const bucketRootHref = "/"
  const segHref = (idx: number): string => {
    const upTo = segments.slice(0, idx + 1)

    return `/_browse/${upTo.join("/")}/`
  }

  return (
    <div
      className="wrap"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {overQuota
        ? (
          <div className="banner red" style={{ margin: "24px 0 0", alignItems: "center" }}>
            <Icon name="up" size={16} style={{ color: "var(--red)", flex: "none", marginTop: 1 }} />
            <div>容量が上限に達しています。新規アップロードは停止中です。ファイルを削除して空き容量ができれば自動的に再開します。ダウンロード・削除は引き続き行えます。</div>
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
          <Button size="sm" onClick={() => void createFolder()}>＋ 新規フォルダ</Button>
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

      <div className={cn("card", { menuopen: openRowMenu !== null })}>
        {selection.size === 0
          ? null
          : (
            <div className="bulkbar">
              <b>{selection.size}件を選択中</b>
              <Button kind="ghost" size="sm" onClick={clearSelection}>選択解除</Button>
              <span style={{ marginLeft: "auto" }} />
              <Button kind="po" size="sm" onClick={() => openShare([...selection])}>共有</Button>
              <Button kind="do" size="sm" onClick={() => openDelete([...selection])}>削除</Button>
            </div>
          )}
        <div className="thead sel">
          <span>
            <Checkbox
              checked={selection.size > 0 && selection.size === rows.length}
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
            更新日
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
                  const href = `/_browse/${segments.join("/")}${segments.length === 0 ? "" : "/"}${name}/`

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
                      <div className="c-act" />
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
                  const rowClass = cn("row sel", {
                    selected: isSelected,
                    public: isPub && !isSelected,
                    presigned: !isPub && presigned !== undefined && !isSelected,
                  })

                  return (
                    <div key={key}>
                      <div className={rowClass}>
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
                        <div className="c-size">{formatBytes(file.size)}</div>
                        <div className="c-date">{formatShortDate(file.lastModified)}</div>
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
                              <MenuItem onClick={() => { setOpenRowMenu(null); openShare([key], "temp") }}>
                                <Icon name="clock" size={15} />
                                期限つきリンクを発行
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
                      {isPub ? (
                        <div className="pubpanel">
                          <div className="pp-top">
                            <span className="lbl">公開URL — 認証なしで誰でもダウンロードできます</span>
                          </div>
                          <LinkBar url={publicUrl(config.publicBase, bucket, key)} tone="ok" copyLabel="コピー" copiedLabel="コピー済み" />
                        </div>
                      ) : null}
                      {presigned !== undefined && !isPub ? (
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
        onClose={() => setShare(null)}
        targets={share?.targets ?? []}
        initialMode={share?.mode ?? "pub"}
      />

      <DeleteModal
        open={deleteTargets !== null}
        onClose={() => setDeleteTargets(null)}
        targets={deleteTargets ?? []}
        onDeleted={async (keys) => {
          setSelection((prev) => {
            const next = new Set(prev)
            for (const k of keys) next.delete(k)

            return next
          })
          await queryClient.invalidateQueries({ queryKey: ["objects", bucket, prefix] })
          await queryClient.invalidateQueries({ queryKey: ["bucket-usage", bucket] })
        }}
      />

      {/* Reserve room below the card for row menus that overflow the card edge (design_handoff #1 uses height:190px). */}
      <div aria-hidden="true" style={{ height: 190 }} />
    </div>
  )
}

// Extracted so Date.now() lives outside render — the ticker updates every 30s.
const ExpiresInMinutes = ({ expiresAtMs }: { expiresAtMs: number }) => {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)

    return () => clearInterval(id)
  }, [])
  const nowMs = now ?? expiresAtMs

  return <>{Math.max(0, Math.round((expiresAtMs - nowMs) / 60000))}</>
}

