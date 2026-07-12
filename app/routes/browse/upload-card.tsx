import type { OperationKind, Transfer } from "~/shell"
import { Button, Icon, type IconName, Tag } from "~/ui"

// Card-header icon. Only two kinds have an unambiguous representative icon
// (upload -> arrow up, delete -> trash); everything else (rename / move /
// copy / any mixed batch) shows no icon so the meaning doesn't clash with
// the label.
const headerIcon = (kinds: ReadonlySet<OperationKind>): IconName | null => {
  if (kinds.size !== 1) return null
  const only = [...kinds][0] as OperationKind
  if (only === "upload") return "up"
  if (only === "delete" || only === "folder-delete") return "trash"

  return null
}

type Props = {
  transfers: readonly Transfer[]
  onCancelAll: () => void
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  onOverwrite: (id: string) => void
  onSaveAs: (id: string) => void
  onSkip: (id: string) => void
  onDismissAll: () => void
}

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  const k = n / 1024
  if (k < 1024) return `${k.toFixed(k < 10 ? 1 : 0)} KB`
  const m = k / 1024
  if (m < 1024) return `${m.toFixed(m < 10 ? 1 : 0)} MB`
  const g = m / 1024
  if (g < 1024) return `${g.toFixed(g < 10 ? 1 : 0)} GB`
  const tt = g / 1024

  return `${tt.toFixed(tt < 10 ? 1 : 0)} TB`
}

const formatSpeed = (bps: number | undefined): string => {
  if (bps === undefined || bps <= 0) return ""

  return `${formatBytes(bps)}/s`
}

// Present-tense verb per operation kind, shown in the "状態" column while an
// operation is running.
const runningVerb = (kind: OperationKind): string => {
  switch (kind) {
    case "upload": return "アップロード中"
    case "delete":
    case "folder-delete": return "削除中"
    case "rename": return "名前変更中"
    case "move":
    case "folder-move": return "移動中"
    case "copy": return "コピー中"
    case "folder-rename": return "フォルダ名変更中"
  }
}

const headerLabel = (kinds: ReadonlySet<OperationKind>): string => {
  if (kinds.size === 0) return "操作"
  if (kinds.size === 1) {
    const only = [...kinds][0] as OperationKind
    switch (only) {
      case "upload": return "アップロード"
      case "delete":
      case "folder-delete": return "削除"
      case "rename": return "名前変更"
      case "move":
      case "folder-move": return "移動"
      case "copy": return "コピー"
      case "folder-rename": return "フォルダ名変更"
    }
  }

  return "進行中"
}

const rowIcon = (t: Transfer): IconName => {
  if (t.state === "done") return "check"
  if (t.isFolder === true) return "folder"
  if (t.kind === "upload") return "file"
  if (t.kind === "delete" || t.kind === "folder-delete") return "trash"
  if (t.kind === "copy") return "file"

  return "file"
}

// upload は bytes、他 kind は件数 で "n 件完了 / m 件" を出す。
const detailText = (t: Transfer): string => {
  if (t.kind === "upload") {
    if (t.state === "uploading" || t.state === "checking") {
      return `${formatBytes(t.loaded)} / ${formatBytes(t.total)}${t.speedBps !== undefined ? ` · ${formatSpeed(t.speedBps)}` : ""}`
    }
    if (t.state === "failed") {
      return t.error === "content mismatch" ? "内容が一致しません" : t.error === "cancelled" ? "キャンセル済み" : "エラー発生"
    }
    if (t.state === "conflict") return "同名が既に存在"
    if (t.state === "done") return formatBytes(t.total)

    return ""
  }
  if (t.state === "failed") return t.error === undefined || t.error === "" ? "エラー発生" : t.error
  if (t.total > 1) return `${t.loaded} / ${t.total} 件`
  if (t.state === "done") return "完了"

  return ""
}

const stateTag = (t: Transfer) => {
  if (t.state === "uploading" || t.state === "checking") return <Tag tone="run">{runningVerb(t.kind)}</Tag>
  if (t.state === "queued") return <Tag tone="neutral">待機中</Tag>
  if (t.state === "failed") return <Tag tone="fail">失敗</Tag>
  if (t.state === "conflict") return <Tag tone="warn">衝突</Tag>
  if (t.state === "paused") return <Tag tone="neutral">一時停止</Tag>

  return <Tag tone="ok">完了</Tag>
}

// Design_handoff frame 5.
export const UploadCard = ({ transfers, onCancelAll, onCancel, onRetry, onOverwrite, onSaveAs, onSkip, onDismissAll }: Props) => {
  if (transfers.length === 0) return null
  const active = transfers.filter((t) => t.state === "uploading" || t.state === "queued" || t.state === "checking").length
  const done = transfers.filter((t) => t.state === "done").length
  const kinds = new Set<OperationKind>(transfers.map((t) => t.kind))
  const label = headerLabel(kinds)
  const icon = headerIcon(kinds)

  return (
    <div className="upcard">
      <div className="uph">
        {icon !== null ? <Icon name={icon} size={15} style={{ color: "var(--brand)" }} /> : null}
        {label} · {active}件処理中 · {done}件完了
        <span className="sp">
          {active > 0
            ? <Button kind="do" size="sm" onClick={onCancelAll}>すべてキャンセル</Button>
            : <Button kind="stop" size="sm" onClick={onDismissAll}>閉じる</Button>}
        </span>
      </div>
      <div className="uhead">
        <span>名前</span>
        <span>状態</span>
        <span>進捗</span>
        <span className="r">詳細</span>
        <span className="r">操作</span>
      </div>
      {transfers.map((t) => {
        const pct = t.total > 0 ? Math.min(100, Math.round((t.loaded / t.total) * 100)) : 0
        const isDone = t.state === "done"
        const isProgressive = t.kind === "upload"
          ? (t.state === "uploading" || t.state === "checking" || t.state === "queued" || isDone)
          : (t.total > 0 && (t.state === "uploading" || isDone))
        const showRetry = t.kind === "upload" && t.state === "failed"
        const showConflict = t.kind === "upload" && t.state === "conflict"

        return (
          <div className="urow" key={t.id}>
            <div className="un">
              {isDone
                ? <Icon name="check" size={16} style={{ color: "var(--green)" }} />
                : <Icon name={rowIcon(t)} size={16} className="ico" />}
              <span title={t.name}>{t.name}</span>
            </div>
            <div>
              {stateTag(t)}
            </div>
            <div>
              {isProgressive
                ? (
                  <div className="pbar" style={t.state === "queued" ? { opacity: 0.4 } : undefined}>
                    <i style={{ width: `${pct}%`, ...(isDone ? { background: "var(--green)" } : {}) }} />
                  </div>
                )
                : null}
            </div>
            <div className="umeta" style={t.state === "failed" ? { color: "var(--red)" } : t.state === "conflict" ? { color: "var(--warnFg)" } : undefined}>
              {detailText(t)}
            </div>
            <div className="uact">
              {t.state === "uploading" || t.state === "checking"
                ? (t.kind === "upload"
                  ? <Button kind="stop" size="sm" onClick={() => onCancel(t.id)}>キャンセル</Button>
                  : null)
                : t.state === "queued"
                  ? <Button kind="do" size="sm" onClick={() => onCancel(t.id)}>キャンセル</Button>
                  : showRetry
                    ? <Button kind="po" size="sm" onClick={() => onRetry(t.id)}>再試行</Button>
                    : showConflict
                      ? (
                        <>
                          <Button kind="do" size="sm" onClick={() => onOverwrite(t.id)}>上書き</Button>
                          <Button kind="po" size="sm" onClick={() => onSaveAs(t.id)}>別名で保存</Button>
                          <Button kind="stop" size="sm" onClick={() => onSkip(t.id)}>スキップ</Button>
                        </>
                      )
                      : t.state === "failed"
                        ? <Button kind="stop" size="sm" onClick={() => onSkip(t.id)}>閉じる</Button>
                        : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
