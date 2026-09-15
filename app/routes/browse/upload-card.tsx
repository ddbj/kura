import { useEffect, useState } from "react"

import { formatBytes } from "~/lib/format"
import { type TFn, useT } from "~/lib/i18n"
import { AUTO_DISMISS_MS, type OperationKind, type Transfer } from "~/shell"
import { Button, Icon, type IconName, Tag } from "~/ui"

// Card-header icon. Only two kinds have an unambiguous representative icon
// (upload -> arrow up, delete -> trash); everything else (rename / move /
// copy / any mixed batch) shows no icon so the meaning doesn't clash with
// the label.
const headerIcon = (kinds: ReadonlySet<OperationKind>): IconName | null => {
  if (kinds.size !== 1) return null
  const only = [...kinds][0] as OperationKind
  if (only === "upload") return "up"
  if (only === "download") return "dl"
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
  onDismissDone: () => void
}

const formatSpeed = (bps: number | undefined): string => {
  if (bps === undefined || bps <= 0) return ""

  return `${formatBytes(bps)}/s`
}

// Present-tense verb per operation kind, shown in the state column while an
// operation is running.
const runningVerb = (kind: OperationKind, t: TFn): string => {
  switch (kind) {
    case "upload": return t("transfers.runningUpload")
    case "download": return t("transfers.runningDownload")
    case "delete": return t("transfers.runningDelete")
    case "folder-delete": return t("transfers.runningFolderDelete")
    case "rename": return t("transfers.runningRename")
    case "move": return t("transfers.runningMove")
    case "folder-move": return t("transfers.runningFolderMove")
    case "copy": return t("transfers.runningCopy")
    case "folder-rename": return t("transfers.runningFolderRename")
  }
}

const headerLabel = (kinds: ReadonlySet<OperationKind>, t: TFn): string => {
  if (kinds.size === 0) return t("transfers.fallbackLabel")
  if (kinds.size === 1) {
    const only = [...kinds][0] as OperationKind
    switch (only) {
      case "upload": return t("transfers.kindUpload")
      case "download": return t("transfers.kindDownload")
      case "delete": return t("transfers.kindDelete")
      case "folder-delete": return t("transfers.kindFolderDelete")
      case "rename": return t("transfers.kindRename")
      case "move": return t("transfers.kindMove")
      case "folder-move": return t("transfers.kindFolderMove")
      case "copy": return t("transfers.kindCopy")
      case "folder-rename": return t("transfers.kindFolderRename")
    }
  }

  return t("transfers.inProgress")
}

const rowIcon = (transfer: Transfer): IconName => {
  if (transfer.state === "done") return "check"
  if (transfer.isFolder === true) return "folder"
  if (transfer.kind === "upload") return "file"
  if (transfer.kind === "download") return "dl"
  if (transfer.kind === "delete" || transfer.kind === "folder-delete") return "trash"

  return "file"
}

// upload は bytes、他 kind は件数で進捗を出す。
const detailText = (transfer: Transfer, t: TFn): string => {
  if (transfer.kind === "upload" || transfer.kind === "download") {
    if (transfer.state === "uploading" || transfer.state === "checking") {
      const speed = transfer.speedBps !== undefined ? ` · ${formatSpeed(transfer.speedBps)}` : ""

      return `${formatBytes(transfer.loaded)} / ${formatBytes(transfer.total)}${speed}`
    }
    if (transfer.state === "failed") {
      if (transfer.error === "content mismatch") return t("transfers.detailMismatch")

      return transfer.error === "cancelled" ? t("transfers.detailCancelled") : t("transfers.detailError")
    }
    if (transfer.state === "conflict") return t("transfers.detailConflict")
    if (transfer.state === "done") return formatBytes(transfer.total)

    return ""
  }
  if (transfer.state === "failed") {
    return transfer.error === undefined || transfer.error === "" ? t("transfers.detailError") : transfer.error
  }
  if (transfer.total > 1) return t("transfers.detailCount", { loaded: transfer.loaded, total: transfer.total })
  if (transfer.state === "done") return t("transfers.stateDone")

  return ""
}

const stateTag = (transfer: Transfer, t: TFn) => {
  if (transfer.state === "uploading" || transfer.state === "checking") {
    return <Tag tone="run">{runningVerb(transfer.kind, t)}</Tag>
  }
  if (transfer.state === "queued") return <Tag tone="neutral">{t("transfers.stateQueued")}</Tag>
  if (transfer.state === "failed") return <Tag tone="fail">{t("transfers.stateFailed")}</Tag>
  if (transfer.state === "conflict") return <Tag tone="warn">{t("transfers.stateConflict")}</Tag>

  return <Tag tone="ok">{t("transfers.stateDone")}</Tag>
}

export const UploadCard = ({ transfers, onCancelAll, onCancel, onRetry, onOverwrite, onSaveAs, onSkip, onDismissAll, onDismissDone }: Props) => {
  const t = useT()
  const active = transfers.filter((tr) => tr.state === "uploading" || tr.state === "queued" || tr.state === "checking").length
  const done = transfers.filter((tr) => tr.state === "done").length

  // pause the auto-dismiss timer while the pointer is over the card or a
  // control inside it holds focus, so a user reading a settled batch is never
  // surprised by rows vanishing mid-scan (Material / NN Group pattern).
  const [hovered, setHovered] = useState(false)
  const [focusedInside, setFocusedInside] = useState(false)
  const canDismiss = active === 0 && done > 0 && !hovered && !focusedInside
  useEffect(() => {
    if (!canDismiss) return
    const timer = setTimeout(onDismissDone, AUTO_DISMISS_MS)

    return () => clearTimeout(timer)
  }, [canDismiss, onDismissDone])

  if (transfers.length === 0) return null
  const kinds = new Set<OperationKind>(transfers.map((tr) => tr.kind))
  const label = headerLabel(kinds, t)
  const icon = headerIcon(kinds)

  return (
    <div
      className="upcard"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusedInside(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusedInside(false)
      }}
    >
      <div className="uph">
        {icon !== null ? <Icon name={icon} size={15} style={{ color: "var(--brand)" }} /> : null}
        <span role="status" aria-live="polite">{t("transfers.header", { label, active, done })}</span>
        <span className="sp">
          {active > 0
            ? <Button kind="do" size="sm" onClick={onCancelAll}>{t("transfers.cancelAll")}</Button>
            : <Button kind="stop" size="sm" onClick={onDismissAll}>{t("common.close")}</Button>}
        </span>
      </div>
      <div className="uhead">
        <span>{t("transfers.colName")}</span>
        <span className="c">{t("transfers.colState")}</span>
        <span>{t("transfers.colProgress")}</span>
        <span className="r">{t("transfers.colDetail")}</span>
        <span className="r">{t("transfers.colActions")}</span>
      </div>
      {transfers.map((transfer) => {
        const pct = transfer.total > 0 ? Math.min(100, Math.round((transfer.loaded / transfer.total) * 100)) : 0
        const isDone = transfer.state === "done"
        const isProgressive = transfer.kind === "upload" || transfer.kind === "download"
          ? (transfer.state === "uploading" || transfer.state === "checking" || transfer.state === "queued" || isDone)
          : (transfer.total > 0 && (transfer.state === "uploading" || isDone))
        const showRetry = transfer.kind === "upload" && transfer.state === "failed"
        const retryLabel = showRetry && transfer.uploadId !== undefined ? t("pendingUploads.resume") : t("common.retry")
        const showConflict = transfer.kind === "upload" && transfer.state === "conflict"

        return (
          <div className="urow" key={transfer.id}>
            <div className="un">
              {isDone
                ? <Icon name="check" size={16} style={{ color: "var(--green)" }} />
                : <Icon name={rowIcon(transfer)} size={16} className="ico" />}
              <span title={transfer.name}>{transfer.name}</span>
            </div>
            <div className="c">
              {stateTag(transfer, t)}
            </div>
            <div>
              {isProgressive
                ? (
                  <div className="pbar" style={transfer.state === "queued" ? { opacity: 0.4 } : undefined}>
                    <i style={{ width: `${pct}%`, ...(isDone ? { background: "var(--green)" } : {}) }} />
                  </div>
                )
                : null}
            </div>
            <div
              className="umeta"
              style={transfer.state === "failed"
                ? { color: "var(--red)" }
                : transfer.state === "conflict" ? { color: "var(--warnFg)" } : undefined}
            >
              {detailText(transfer, t)}
            </div>
            <div className="uact">
              {transfer.state === "uploading" || transfer.state === "checking"
                ? (transfer.kind === "upload" || transfer.kind === "download"
                  ? <Button kind="stop" size="sm" onClick={() => onCancel(transfer.id)}>{t("common.cancel")}</Button>
                  : null)
                : transfer.state === "queued"
                  ? <Button kind="do" size="sm" onClick={() => onCancel(transfer.id)}>{t("common.cancel")}</Button>
                  : showRetry
                    ? <Button kind="po" size="sm" onClick={() => onRetry(transfer.id)}>{retryLabel}</Button>
                    : showConflict
                      ? (
                        <>
                          <Button kind="do" size="sm" onClick={() => onOverwrite(transfer.id)}>{t("transfers.actionOverwrite")}</Button>
                          <Button kind="po" size="sm" onClick={() => onSaveAs(transfer.id)}>{t("transfers.actionSaveAs")}</Button>
                          <Button kind="stop" size="sm" onClick={() => onSkip(transfer.id)}>{t("transfers.actionSkip")}</Button>
                        </>
                      )
                      : transfer.state === "failed"
                        ? <Button kind="stop" size="sm" onClick={() => onSkip(transfer.id)}>{t("common.close")}</Button>
                        : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
