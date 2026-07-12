import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useAuth } from "react-oidc-context"

import { useConfig } from "~/lib/config"
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
type Ttl = 5 | 15 | 60

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  const k = n / 1024
  if (k < 1024) return `${k.toFixed(k < 10 ? 1 : 0)} KB`
  const m = k / 1024
  if (m < 1024) return `${m.toFixed(m < 10 ? 1 : 0)} MB`
  const g = m / 1024

  return `${g.toFixed(g < 10 ? 1 : 0)} GB`
}

// Design_handoff frames 7 & 8.
export const ShareModal = ({ open, onClose, targets, initialMode = "pub" }: Props) => {
  const config = useConfig()
  const auth = useAuth()
  const s3 = useS3()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [ttl, setTtl] = useState<Ttl>(60)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [issued, setIssued] = useState<{ url: string; name: string; expiresAt: Date | null }[]>([])

  useEffect(() => {
    if (open) {
      setMode(initialMode)
      setIssued([])
      setError(undefined)
    }
  }, [open, initialMode])

  const onSubmit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      if (mode === "pub") {
        const results: { url: string; name: string; expiresAt: null }[] = []
        for (const target of targets) {
          const token = beginPublicStateChange(target.bucket, target.key)
          try {
            await publishObject(s3, target.bucket, target.key)
            await applyPublicState(queryClient, target.bucket, target.key, true, token)
          } catch (err) {
            await revertPublicStateOnFailure(queryClient, target.bucket, target.key, token)
            throw err
          }
          results.push({
            url: publicUrl(config.publicBase, target.bucket, target.key),
            name: target.name,
            expiresAt: null,
          })
        }
        setIssued(results)
      } else {
        const expiresIn = ttl * 60
        const results: { url: string; name: string; expiresAt: Date }[] = []
        for (const target of targets) {
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
          results.push({ url: presigned.url, name: target.name, expiresAt: presigned.expiresAt })
        }
        setIssued(results)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="share-title">
      <div className="mh split">
        <b id="share-title">ファイルを共有</b>
        <ModeSwitch<Mode>
          value={mode}
          onChange={(next) => { setMode(next); setIssued([]) }}
          ariaLabel="共有モード"
          options={[
            { value: "pub", label: <><Tag tone="ok">公開</Tag>恒久URL</> },
            { value: "temp", label: <><Tag tone="warn">期限つき</Tag>一時リンク</> },
          ]}
        />
      </div>

      <div className="lbl" style={{ color: "var(--inkMid)", marginBottom: 6 }}>対象 {targets.length}件</div>
      <div className="flist">
        {targets.map((t) => (
          <div className="frow" key={`${t.bucket}/${t.key}`}>
            <span className="fn" title={t.key}>{t.name}</span>
            <span className="fmeta">{formatBytes(t.size)}</span>
          </div>
        ))}
      </div>

      {mode === "pub" ? (
        <div className="sharemode on">
          {issued.length === 0 ? (
            <>
              <Callout tone="ok">
                リンクを知っていれば、ログインなしで誰でもダウンロードできます。公開を止めるまで有効です。
              </Callout>
              {error !== undefined ? <p className="err">{error}</p> : null}
              <div className="mfoot">
                <Button onClick={onClose}>キャンセル</Button>
                <Button kind="pri" disabled={busy} onClick={() => void onSubmit()}>
                  {busy ? "処理中…" : "公開する"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                {issued.map((i) => (
                  <div key={i.url}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--inkSoft)", marginBottom: 4 }}>{i.name}</div>
                    <LinkBar url={i.url} tone="ok" copyLabel="コピー" copiedLabel="コピー済み" />
                  </div>
                ))}
              </div>
              <div className="mfoot">
                <Button kind="pri" onClick={onClose}>閉じる</Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="sharemode on">
          {issued.length === 0 ? (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "2px 0 12px" }}>
                <span className="lbl" style={{ color: "var(--inkMid)" }}>有効期限</span>
                <Segmented<Ttl>
                  value={ttl}
                  onChange={setTtl}
                  ariaLabel="有効期限"
                  options={[
                    { value: 5, label: "5分" },
                    { value: 15, label: "15分" },
                    { value: 60, label: "1時間" },
                  ]}
                />
              </div>
              <div className="banner ochre">
                <Icon name="clock" size={15} style={{ color: "var(--warnFg)", flex: "none" }} />
                <div>リンクは最長で約{ttl === 60 ? "1時間" : `${ttl}分`}後に切れます。発行したあとに延長や取り消しはできません。</div>
              </div>
              {error !== undefined ? <p className="err">{error}</p> : null}
              <div className="mfoot">
                <Button onClick={onClose}>キャンセル</Button>
                <Button kind="pri" disabled={busy} onClick={() => void onSubmit()}>
                  {busy ? "発行中…" : "リンクを発行"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                {issued.map((i) => (
                  <div key={i.url}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--inkSoft)", marginBottom: 4 }}>{i.name}</div>
                    <LinkBar url={i.url} tone="warn" copyLabel="コピー" copiedLabel="コピー済み" />
                    {i.expiresAt !== null
                      ? <div style={{ fontSize: 11, color: "var(--inkSoft)", marginTop: 4 }}>{i.expiresAt.toLocaleString()} まで有効</div>
                      : null}
                  </div>
                ))}
              </div>
              <div className="mfoot">
                <Button kind="pri" onClick={onClose}>閉じる</Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
