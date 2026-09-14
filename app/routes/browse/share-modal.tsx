import { useEffect, useMemo, useState } from "react"
import { useAuth } from "react-oidc-context"

import { useConfig } from "~/lib/config"
import { formatBytes, formatDuration } from "~/lib/format"
import { formatDateTimeLocalized, useLang, useT } from "~/lib/i18n"
import { accessTokenForDuration, freshAccessToken, presignShareUrl } from "~/lib/s3"
import { addSessionPresigned } from "~/lib/session-presigned"
import { Button, Icon, LinkBar, Modal, Segmented, Tag } from "~/ui"

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

// SeaweedFS の STS が持つ DurationSeconds の固定上限。"max" はこれを要求し、
// 実際の寿命は access token の残り寿命まで STS 側で切り詰められる。
const MAX_PRESIGN_SECONDS = 43_200

type Ttl = 15 | 60 | "max"

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
  const [ttl, setTtl] = useState<Ttl>("max")
  // モーダルを開いた時点のセッション残り。表示だけに使うので開くたびに固定する。
  const [sessionRemainingS, setSessionRemainingS] = useState<number | undefined>(undefined)
  const [busyBatch, setBusyBatch] = useState(false)
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({})

  const rowKey = (t: Target): string => `${t.bucket}/${t.key}`

  useEffect(() => {
    if (open) {
      setRowStates({})
      setBusyBatch(false)
      setSessionRemainingS(typeof auth.user?.expires_in === "number" ? auth.user.expires_in : undefined)
    }
  }, [open, auth.user])

  const requestedSeconds = ttl === "max" ? MAX_PRESIGN_SECONDS : ttl * 60
  // 認証セッションの残りが要求より短ければ、そちらが実際の寿命になる。
  const effectiveSeconds = sessionRemainingS === undefined
    ? requestedSeconds
    : Math.min(requestedSeconds, sessionRemainingS)

  const runOne = async (target: Target): Promise<RowState> => {
    const expiresIn = requestedSeconds
    // "max" はセッションの残りをそのまま使う。満たしようのない長さを要求して
    // 無駄な renew を走らせない。
    const token = ttl === "max"
      ? await freshAccessToken(auth)
      : await accessTokenForDuration(auth, expiresIn)
    const presigned = await presignShareUrl({
      endpoint: config.s3Endpoint,
      token,
      bucket: target.bucket,
      key: target.key,
      method: "GET",
      expiresInSeconds: expiresIn,
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

      <div className="sharemode on">
        {!anyIssued ? (
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
                  { value: "max", label: t("share.ttlMax") },
                ]}
              />
            </div>
            <div className="banner ochre">
              <Icon name="clock" size={15} style={{ color: "var(--warnFg)", flex: "none" }} />
              <div>{t(ttl === "max" ? "share.noticeMax" : "share.notice", { duration: formatDuration(effectiveSeconds / 60, t) })}</div>
            </div>
          </>
        ) : null}
      </div>

      {anyIssued ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          {targets.map((target) => {
            const state = rowStates[rowKey(target)]
            if (state === undefined || state.phase === "idle" || state.phase === "busy") return null
            if (state.phase === "err") {
              return (
                <div key={rowKey(target)}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--inkSoft)", marginBottom: 4 }}>{target.name}</div>
                  <p className="err" style={{ margin: 0 }}>{t("share.failedPrefix", { message: state.message })}</p>
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
