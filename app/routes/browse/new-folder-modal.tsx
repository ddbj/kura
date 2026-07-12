import { PutObjectCommand } from "@aws-sdk/client-s3"
import { useEffect, useState } from "react"

import { useS3 } from "~/lib/s3/use-s3"
import { Button, Modal, TextInput } from "~/ui"

type Props = {
  open: boolean
  onClose: () => void
  bucket: string
  prefix: string
  existingNames: readonly string[]
  onCreated: () => void | Promise<void>
}

const validate = (name: string, existing: readonly string[]): string | undefined => {
  const trimmed = name.trim()
  if (trimmed === "") return "フォルダ名を入力してください"
  if (trimmed.includes("/")) return "フォルダ名に「/」は使えません"
  if (existing.includes(trimmed)) return `「${trimmed}」は既にあります`

  return undefined
}

export const NewFolderModal = ({ open, onClose, bucket, prefix, existingNames, onCreated }: Props) => {
  const s3 = useS3()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName("")
      setError(undefined)
      setBusy(false)
    }
  }, [open])

  const onSubmit = async () => {
    const trimmed = name.trim()
    const validationError = validate(trimmed, existingNames)
    if (validationError !== undefined) {
      setError(validationError)

      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const key = `${prefix}${trimmed}/.keep`
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: new Uint8Array(0) }))
      await onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="newfolder-title">
      <div className="mh">
        <b id="newfolder-title">新しいフォルダ</b>
      </div>
      <div className="field">
        <label className="flabel" htmlFor="newfolder-name">フォルダ名</label>
        <TextInput
          id="newfolder-name"
          value={name}
          disabled={busy}
          error={error !== undefined}
          onChange={(next) => {
            setName(next)
            if (error !== undefined) setError(undefined)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              void onSubmit()
            }
          }}
        />
        {error !== undefined ? <p className="ferr">{error}</p> : null}
      </div>
      <div className="mfoot">
        <Button onClick={onClose} disabled={busy}>キャンセル</Button>
        <Button kind="pri" disabled={busy} onClick={() => void onSubmit()}>
          {busy ? "作成中…" : "作成"}
        </Button>
      </div>
    </Modal>
  )
}
