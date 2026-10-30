import { useMemo, useState } from "react"
import { useAuth } from "react-oidc-context"

import { useConfig } from "~/lib/config"
import { formatBytes, formatDuration } from "~/lib/format"
import { formatDateTimeLocalized, useLang, useT } from "~/lib/i18n"
import { freshAccessToken, presignShareUrl } from "~/lib/s3"
import { addSessionPresigned } from "~/lib/session-presigned"
import { Button, Callout, LinkBar, Modal, Segmented, Tag } from "~/ui"

type Target = {
  bucket: string
  key: string
  name: string
  size: number
}

type Props = {
  open: boolean
  onClose: () => void
  targets: Target[]
}

// 分。上限の 12 時間は STS session の上限（sts.maxSessionLength）と同じ。
type Ttl = 15 | 60 | 720

type RowState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "ok"; url: string; expiresAt: Date }
  | { phase: "err"; message: string }

// Runs targets in parallel via allSettled so a single failure doesn't stop the
// whole batch, and lets the user retry just the failed rows without re-running
// the successful ones.
export const ShareModal = ({ open, onClose, targets }: Props) => {
  const config = useConfig()
  const auth = useAuth()
  const t = useT()
  const lang = useLang()
  const [ttl, setTtl] = useState<Ttl>(720)
  const [busyBatch, setBusyBatch] = useState(false)
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({})
  const [wasOpen, setWasOpen] = useState(false)

  const rowKey = (t: Target): string => `${t.bucket}/${t.key}`

  // 「閉→開」の遷移でだけリセットする。発行そのものが silent renew を起こしうる
  // ので、auth.user の変化に反応させると発行済みのリンク一覧がその場で消える。
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setRowStates({})
      setBusyBatch(false)
    }
  }

  const expiresInSeconds = ttl * 60

  const runOne = async (target: Target): Promise<RowState> => {
    const presigned = await presignShareUrl({
      endpoint: config.s3Endpoint,
      token: await freshAccessToken(auth),
      bucket: target.bucket,
      key: target.key,
      method: "GET",
      expiresInSeconds,
    })
    addSessionPresigned({
      bucket: target.bucket,
      key: target.key,
      url: presigned.url,
      method: "GET",
      expiresAt: presigned.expiresAt.getTime(),
    })

    return { phase: "ok", url: presigned.url, expiresAt: presigned.expiresAt }
  }

  const runBatch = async (subset: Target[]): Promise<void> => {
    setBusyBatch(true)
    setRowStates((prev) => {
      const next = { ...prev }
      for (const t of subset) next[rowKey(t)] = { phase: "busy" }

      return next
    })
    const settled = await Promise.allSettled(subset.map((t) => runOne(t).then((state) => [rowKey(t), state] as const)))
    setRowStates((prev) => {
      const next = { ...prev }
      for (const [i, s] of settled.entries()) {
        const target = subset[i] as Target
        if (s.status === "fulfilled") {
          next[s.value[0]] = s.value[1]
        } else {
          const message = s.reason instanceof Error ? s.reason.message : String(s.reason)
          next[rowKey(target)] = { phase: "err", message }
        }
      }

      return next
    })
    setBusyBatch(false)
  }

  const onSubmitAll = () => void runBatch(targets)
  const onRetryFailed = () => {
    const failed = targets.filter((target) => rowStates[rowKey(target)]?.phase === "err")
    void runBatch(failed)
  }

  const summary = useMemo(() => {
    let ok = 0, err = 0, busy = 0
    for (const target of targets) {
      const s = rowStates[rowKey(target)]
      if (s === undefined) continue
      if (s.phase === "ok") ok += 1
      else if (s.phase === "err") err += 1
      else if (s.phase === "busy") busy += 1
    }

    return { ok, err, busy }
  }, [rowStates, targets])

  const anyIssued = summary.ok > 0 || summary.err > 0

  return (
    <Modal open={open} onClose={onClose} labelledBy="share-title">
      <div className="mh split">
        <h2 className="mtitle" id="share-title">{t("share.title")}</h2>
        <Tag tone="warn">{t("browse.timedTag")}</Tag>
      </div>

      <div className="flist">
        {targets.map((target) => {
          const state = rowStates[rowKey(target)]

          return (
            <div className="frow" key={rowKey(target)}>
              <span className="fn" title={target.key}>{target.name}</span>
              <span className="fmeta" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {state?.phase === "busy" ? <Tag tone="run">{t("share.statusIssuing")}</Tag> : null}
                {state?.phase === "ok" ? <Tag tone="ok">{t("share.statusDone")}</Tag> : null}
                {state?.phase === "err" ? <Tag tone="fail">{t("share.statusFailed")}</Tag> : null}
                <span>{formatBytes(target.size)}</span>
              </span>
            </div>
          )
        })}
      </div>

      {!anyIssued
        ? (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "2px 0 12px" }}>
              <span className="lbl" style={{ color: "var(--inkMid)" }}>{t("share.ttlLabel")}</span>
              <Segmented<Ttl>
                value={ttl}
                onChange={setTtl}
                ariaLabel={t("share.ttlLabel")}
                options={[
                  { value: 15, label: t("share.ttl15") },
                  { value: 60, label: t("share.ttl60") },
                  { value: 720, label: t("share.ttl720") },
                ]}
              />
            </div>
            <Callout tone="warn">
              {t("share.notice", { duration: formatDuration(ttl, t) })}
            </Callout>
          </>
        )
        : null}

      {anyIssued ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          {targets.map((target) => {
            const state = rowStates[rowKey(target)]
            if (state === undefined || state.phase === "idle" || state.phase === "busy") return null
            if (state.phase === "err") {
              return (
                <div key={rowKey(target)}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--inkSoft)", marginBottom: 4 }}>{target.name}</div>
                  <p className="err" role="alert" style={{ margin: 0 }}>{t("share.failedPrefix", { message: state.message })}</p>
                </div>
              )
            }

            return (
              <div key={rowKey(target)}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--inkSoft)", marginBottom: 4 }}>{target.name}</div>
                <LinkBar url={state.url} tone="warn" copyLabel={t("common.copy")} copiedLabel={t("common.copied")} />
                <div style={{ fontSize: 11, color: "var(--inkSoft)", marginTop: 4 }}>
                  {t("share.expiresAt", { datetime: formatDateTimeLocalized(state.expiresAt, lang) })}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="mfoot">
        {!anyIssued
          ? (
            <>
              <Button onClick={onClose}>{t("common.cancel")}</Button>
              <Button kind="pri" disabled={busyBatch} onClick={onSubmitAll}>
                {busyBatch ? t("share.issuing") : t("share.issue")}
              </Button>
            </>
          )
          : summary.err > 0
            ? (
              <>
                <Button onClick={onClose}>{t("common.close")}</Button>
                <Button kind="pri" disabled={busyBatch} onClick={onRetryFailed}>
                  {busyBatch ? t("share.retrying") : t("share.retryFailed", { n: summary.err })}
                </Button>
              </>
            )
            : <Button kind="pri" onClick={onClose}>{t("common.close")}</Button>}
      </div>
    </Modal>
  )
}
