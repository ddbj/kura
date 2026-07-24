import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { useAuth } from "react-oidc-context"

import { useConfig } from "~/lib/config"
import { formatBytes } from "~/lib/format"
import {
  accessTokenForDuration,
  applyPublicState,
  beginPublicStateChange,
  presignShareUrl,
  publicUrl,
  publishObject,
  revertPublicStateOnFailure,
} from "~/lib/s3"
import { useS3 } from "~/lib/s3/use-s3"
import { addSessionPresigned } from "~/lib/session-presigned"
import { Button, Callout, Icon, LinkBar, Modal, ModeSwitch, Segmented, Tag } from "~/ui"

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
  initialMode?: "pub" | "temp"
}

type Mode = "pub" | "temp"
type Ttl = 15 | 60 | 720

type RowState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "ok"; url: string; expiresAt: Date | null }
  | { phase: "err"; message: string }

// Design_handoff frames 7 & 8. Runs targets in parallel via allSettled so a
// single failure doesn't stop the whole batch, and lets the user retry just
// the failed rows without re-running the successful ones.
export const ShareModal = ({ open, onClose, targets, initialMode = "pub" }: Props) => {
  const config = useConfig()
  const auth = useAuth()
  const s3 = useS3()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [ttl, setTtl] = useState<Ttl>(720)
  const [busyBatch, setBusyBatch] = useState(false)
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({})

  const rowKey = (t: Target): string => `${t.bucket}/${t.key}`

  useEffect(() => {
    if (open) {
      setMode(initialMode)
      setRowStates({})
      setBusyBatch(false)
    }
  }, [open, initialMode])

  // Mode switch invalidates any URL already issued — the current mode drives
  // whether the successful rows are public URLs or presigned URLs.
  const resetOnModeChange = (next: Mode) => {
    setMode(next)
    setRowStates({})
  }

  const runOne = async (target: Target): Promise<RowState> => {
    if (mode === "pub") {
      const token = beginPublicStateChange(target.bucket, target.key)
      try {
        await publishObject(s3, target.bucket, target.key)
        await applyPublicState(queryClient, target.bucket, target.key, true, token)

        return { phase: "ok", url: publicUrl(config.publicBase, target.bucket, target.key), expiresAt: null }
      } catch (err) {
        await revertPublicStateOnFailure(queryClient, target.bucket, target.key, token)
        throw err
      }
    }
    const expiresIn = ttl * 60
    const token = await accessTokenForDuration(auth, expiresIn)
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
    const failed = targets.filter((t) => rowStates[rowKey(t)]?.phase === "err")
    void runBatch(failed)
  }

  const summary = useMemo(() => {
    let ok = 0, err = 0, busy = 0
    for (const t of targets) {
      const s = rowStates[rowKey(t)]
      if (s === undefined) continue
      if (s.phase === "ok") ok += 1
      else if (s.phase === "err") err += 1
      else if (s.phase === "busy") busy += 1
    }

    return { ok, err, busy }
  }, [rowStates, targets])

  const anyIssued = summary.ok > 0 || summary.err > 0
  const title = mode === "pub" ? "ファイルを公開" : "期限つきリンクを発行"

  return (
    <Modal open={open} onClose={onClose} labelledBy="share-title">
      <div className="mh split">
        <h2 className="mtitle" id="share-title">{title}</h2>
        <ModeSwitch<Mode>
          value={mode}
          onChange={resetOnModeChange}
          ariaLabel="共有モード"
          options={[
            { value: "pub", label: <><Tag tone="ok">公開</Tag>恒久URL</> },
            { value: "temp", label: <><Tag tone="warn">期限つき</Tag>一時リンク</> },
          ]}
        />
      </div>

      <div className="flist">
        {targets.map((t) => {
          const state = rowStates[rowKey(t)]

          return (
            <div className="frow" key={rowKey(t)}>
              <span className="fn" title={t.key}>{t.name}</span>
              <span className="fmeta" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {state?.phase === "busy" ? <Tag tone="run">発行中</Tag> : null}
                {state?.phase === "ok" ? <Tag tone="ok">完了</Tag> : null}
                {state?.phase === "err" ? <Tag tone="fail">失敗</Tag> : null}
                <span>{formatBytes(t.size)}</span>
              </span>
            </div>
          )
        })}
      </div>

      {mode === "pub" ? (
        <div className="sharemode on">
          {!anyIssued ? (
            <Callout tone="ok">
              リンクを知っていれば、ログインなしで誰でもダウンロードできます。公開を止めるまで有効です。
            </Callout>
          ) : null}
        </div>
      ) : (
        <div className="sharemode on">
          {!anyIssued ? (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "2px 0 12px" }}>
                <span className="lbl" style={{ color: "var(--inkMid)" }}>有効期限</span>
                <Segmented<Ttl>
                  value={ttl}
                  onChange={setTtl}
                  ariaLabel="有効期限"
                  options={[
                    { value: 15, label: "15分" },
                    { value: 60, label: "1時間" },
                    { value: 720, label: "12時間" },
                  ]}
                />
              </div>
              <div className="banner ochre">
                <Icon name="clock" size={15} style={{ color: "var(--warnFg)", flex: "none" }} />
                <div>リンクは最長で約{ttl === 720 ? "12時間" : ttl === 60 ? "1時間" : `${ttl}分`}後に切れます。発行したあとに延長や取り消しはできません。</div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {anyIssued ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          {targets.map((t) => {
            const state = rowStates[rowKey(t)]
            if (state === undefined || state.phase === "idle" || state.phase === "busy") return null
            if (state.phase === "err") {
              return (
                <div key={rowKey(t)}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--inkSoft)", marginBottom: 4 }}>{t.name}</div>
                  <p className="err" style={{ margin: 0 }}>失敗: {state.message}</p>
                </div>
              )
            }

            return (
              <div key={rowKey(t)}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--inkSoft)", marginBottom: 4 }}>{t.name}</div>
                <LinkBar url={state.url} tone={mode === "pub" ? "ok" : "warn"} copyLabel="コピー" copiedLabel="コピー済み" />
                {state.expiresAt !== null
                  ? <div style={{ fontSize: 11, color: "var(--inkSoft)", marginTop: 4 }}>{state.expiresAt.toLocaleString()} まで有効</div>
                  : null}
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="mfoot">
        {!anyIssued
          ? (
            <>
              <Button onClick={onClose}>キャンセル</Button>
              <Button kind="pri" disabled={busyBatch} onClick={onSubmitAll}>
                {busyBatch ? "処理中…" : (mode === "pub" ? "公開する" : "リンクを発行")}
              </Button>
            </>
          )
          : summary.err > 0
            ? (
              <>
                <Button onClick={onClose}>閉じる</Button>
                <Button kind="pri" disabled={busyBatch} onClick={onRetryFailed}>
                  {busyBatch ? "再試行中…" : `失敗した${summary.err}件を再試行`}
                </Button>
              </>
            )
            : <Button kind="pri" onClick={onClose}>閉じる</Button>}
      </div>
    </Modal>
  )
}
