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

const validate = (name: string, current: string, siblings: readonly string[]): string | undefined => {
  const trimmed = name.trim()
  if (trimmed === "") return "名前を入力してください"
  if (trimmed.includes("/")) return "名前に「/」は使えません"
  if (trimmed === current) return "元の名前と同じです"
  if (siblings.includes(trimmed)) return `「${trimmed}」は既にあります`

  return undefined
}

// Head-checks the destination on submit to catch collisions with objects that
// aren't in the same directory listing (e.g. hidden files, or something the
// UI hasn't refetched). A false negative (deleted between check and submit)
// is fine — worst case is a normal overwrite.
export const RenameModal = ({ open, onClose, bucket, srcKey, siblingNames, onConfirm }: Props) => {
  const s3 = useS3()
  const currentName = nameOf(srcKey)
  const [name, setName] = useState(currentName)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(currentName)
      setError(undefined)
      setBusy(false)
    }
  }, [open, currentName])

  const submit = async () => {
    const trimmed = name.trim()
    const validationError = validate(trimmed, currentName, siblingNames)
    if (validationError !== undefined) {
      setError(validationError)

      return
    }
    const destKey = `${parentOf(srcKey)}${trimmed}`
    setBusy(true)
    try {
      // Second-level guard against silent overwrite.
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
    <Modal open={open} onClose={onClose} labelledBy="rename-title">
      <div className="mh">
        <b id="rename-title">名前を変更</b>
      </div>
      <div className="field">
        <label className="flabel" htmlFor="rename-name">新しい名前</label>
        <TextInput
          id="rename-name"
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
          {busy ? "確認中…" : "変更"}
        </Button>
      </div>
    </Modal>
  )
}
