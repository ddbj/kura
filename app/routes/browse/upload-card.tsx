import type { Transfer } from "~/shell"
import { Button, Icon, Tag } from "~/ui"

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

// Design_handoff frame 5.
export const UploadCard = ({ transfers, onCancelAll, onCancel, onRetry, onOverwrite, onSaveAs, onSkip, onDismissAll }: Props) => {
  if (transfers.length === 0) return null
  const active = transfers.filter((t) => t.state === "uploading" || t.state === "queued" || t.state === "checking").length
  const done = transfers.filter((t) => t.state === "done").length

  return (
    <div className="upcard">
      <div className="uph">
        <Icon name="up" size={15} style={{ color: "var(--brand)" }} />
        アップロード — {active}件処理中 · {done}件完了
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

        return (
          <div className="urow" key={t.id}>
            <div className="un">
              {isDone
                ? <Icon name="check" size={16} style={{ color: "var(--green)" }} />
                : <Icon name={t.isFolder === true ? "folder" : "file"} size={16} className="ico" />}
              <span title={t.name}>{t.name}</span>
            </div>
            <div>
              {t.state === "uploading" || t.state === "checking"
                ? <Tag tone="run">アップロード中</Tag>
                : t.state === "queued"
                  ? <Tag tone="neutral">待機中</Tag>
                  : t.state === "failed"
                    ? <Tag tone="fail">失敗</Tag>
                    : t.state === "conflict"
                      ? <Tag tone="warn">衝突</Tag>
                      : t.state === "paused"
                        ? <Tag tone="neutral">一時停止</Tag>
                        : <Tag tone="ok">完了</Tag>}
            </div>
            <div>
              {t.state === "uploading" || t.state === "checking" || t.state === "queued" || isDone
                ? (
                  <div className="pbar" style={t.state === "queued" ? { opacity: 0.4 } : undefined}>
                    <i style={{ width: `${pct}%`, ...(isDone ? { background: "var(--green)" } : {}) }} />
                  </div>
                )
                : null}
            </div>
            <div className="umeta" style={t.state === "failed" ? { color: "var(--red)" } : t.state === "conflict" ? { color: "var(--warnFg)" } : undefined}>
              {t.state === "uploading" || t.state === "checking"
                ? `${formatBytes(t.loaded)} / ${formatBytes(t.total)}${t.speedBps !== undefined ? ` · ${formatSpeed(t.speedBps)}` : ""}`
                : t.state === "failed"
                  ? (t.error === "content mismatch" ? "内容が一致しません" : t.error === "cancelled" ? "キャンセル済み" : "エラー発生")
                  : t.state === "conflict"
                    ? "同名が既に存在"
                    : isDone
                      ? formatBytes(t.total)
                      : ""}
            </div>
            <div className="uact">
              {t.state === "uploading" || t.state === "checking"
                ? <Button kind="stop" size="sm" onClick={() => onCancel(t.id)}>キャンセル</Button>
                : t.state === "queued"
                  ? <Button kind="do" size="sm" onClick={() => onCancel(t.id)}>キャンセル</Button>
                  : t.state === "failed"
                    ? <Button kind="po" size="sm" onClick={() => onRetry(t.id)}>再試行</Button>
                    : t.state === "conflict"
                      ? (
                        <>
                          <Button kind="do" size="sm" onClick={() => onOverwrite(t.id)}>上書き</Button>
                          <Button kind="po" size="sm" onClick={() => onSaveAs(t.id)}>別名で保存</Button>
                          <Button kind="stop" size="sm" onClick={() => onSkip(t.id)}>スキップ</Button>
                        </>
                      )
                      : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
