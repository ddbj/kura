import { HeadObjectCommand } from "@aws-sdk/client-s3"
import { useEffect, useState } from "react"

import { useS3 } from "~/lib/s3/use-s3"
import { Button, Modal, TextInput } from "~/ui"

type Props = {
  open: boolean
  onClose: () => void
  bucket: string
  srcKey: string
  siblingNames: readonly string[]
  onConfirm: (destKey: string) => void
}

const parentOf = (key: string): string => {
  const slash = key.lastIndexOf("/")

  return slash === -1 ? "" : key.slice(0, slash + 1)
}

const nameOf = (key: string): string => {
  const slash = key.lastIndexOf("/")

  return slash === -1 ? key : key.slice(slash + 1)
}

const suggestCopyName = (name: string, siblings: readonly string[]): string => {
  const dot = name.lastIndexOf(".")
  const stem = dot <= 0 ? name : name.slice(0, dot)
  const ext = dot <= 0 ? "" : name.slice(dot)
  let candidate = `${stem} のコピー${ext}`
  let n = 2
  while (siblings.includes(candidate)) {
    candidate = `${stem} のコピー (${n})${ext}`
    n += 1
  }

  return candidate
}

const validate = (name: string, siblings: readonly string[]): string | undefined => {
  const trimmed = name.trim()
  if (trimmed === "") return "名前を入力してください"
  if (trimmed.includes("/")) return "名前に「/」は使えません"
  if (siblings.includes(trimmed)) return `「${trimmed}」は既にあります`

  return undefined
}

// Simplified: copy always lands in the same folder — Drive's "Move" happens
// as a separate step. This keeps the modal to a single text field.
export const CopyModal = ({ open, onClose, bucket, srcKey, siblingNames, onConfirm }: Props) => {
  const s3 = useS3()
  const original = nameOf(srcKey)
  const [name, setName] = useState(() => suggestCopyName(original, siblingNames))
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(suggestCopyName(original, siblingNames))
      setError(undefined)
      setBusy(false)
    }
  }, [open, original, siblingNames])

  const submit = async () => {
    const trimmed = name.trim()
    const validationError = validate(trimmed, siblingNames)
    if (validationError !== undefined) {
      setError(validationError)

      return
    }
    const destKey = `${parentOf(srcKey)}${trimmed}`
    setBusy(true)
    try {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: destKey }))
        setError(`「${trimmed}」は既にあります`)
        setBusy(false)

        return
      } catch (err) {
        const status = typeof err === "object" && err !== null && "$metadata" in err
          ? (err as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode
          : undefined
        if (status !== 404 && status !== 403) throw err
      }
      onConfirm(destKey)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="copy-title">
      <div className="mh">
        <b id="copy-title">コピー</b>
      </div>
      <div className="field">
        <label className="flabel" htmlFor="copy-name">コピー後の名前</label>
        <TextInput
          id="copy-name"
          value={name}
          disabled={busy}
          error={error !== undefined}
          onChange={(next) => { setName(next); if (error !== undefined) setError(undefined) }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              void submit()
            }
          }}
        />
        {error !== undefined ? <p className="ferr">{error}</p> : null}
      </div>
      <div className="mfoot">
        <Button onClick={onClose} disabled={busy}>キャンセル</Button>
        <Button kind="pri" disabled={busy} onClick={() => void submit()}>
          {busy ? "確認中…" : "コピー"}
        </Button>
      </div>
    </Modal>
  )
}
