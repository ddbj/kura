import { HeadObjectCommand } from "@aws-sdk/client-s3"
import { useEffect, useState } from "react"

import { useS3 } from "~/lib/s3/use-s3"
import { Button, Icon, Modal } from "~/ui"

import { FolderPicker } from "./folder-picker"

type Props = {
  open: boolean
  onClose: () => void
  bucket: string
  // srcKey is a file key. For folders, use FolderMoveModal.
  srcKey: string
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

export const MoveModal = ({ open, onClose, bucket, srcKey, onConfirm }: Props) => {
  const s3 = useS3()
  const initialParent = parentOf(srcKey)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [destPrefix, setDestPrefix] = useState<string>(initialParent)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setDestPrefix(initialParent)
      setError(undefined)
      setBusy(false)
      setPickerOpen(false)
    }
  }, [open, initialParent])

  const name = nameOf(srcKey)

  const submit = async () => {
    if (destPrefix === initialParent) {
      setError("移動先が元の場所と同じです")

      return
    }
    const destKey = `${destPrefix}${name}`
    setBusy(true)
    try {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: destKey }))
        setError(`移動先に「${name}」が既にあります`)
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

  const displayPath = destPrefix === "" ? bucket : `${bucket}/${destPrefix.slice(0, -1)}`

  return (
    <>
      <Modal open={open && !pickerOpen} onClose={onClose} labelledBy="move-title">
        <div className="mh">
          <h2 className="mtitle" id="move-title">ファイルを移動</h2>
        </div>
        <div className="mdest">
          <div className="mdest-label">移動元</div>
          <div className="mdest-row">
            <div className="mdest-path">
              <Icon name="file" size={14} />
              <span className="p" title={name}>{name}</span>
            </div>
          </div>
        </div>
        <div className="mdest">
          <div className="mdest-label">移動先</div>
          <div className="mdest-row">
            <div className="mdest-path">
              <Icon name="folder" size={14} />
              <span className="p" title={displayPath}>{displayPath}</span>
            </div>
            <Button kind="po" size="sm" onClick={() => setPickerOpen(true)}>フォルダを選ぶ</Button>
          </div>
        </div>
        {error !== undefined ? <p className="ferr">{error}</p> : null}
        <div className="mfoot">
          <Button onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button kind="pri" disabled={busy} onClick={() => void submit()}>
            {busy ? "確認中…" : "移動"}
          </Button>
        </div>
      </Modal>
      <FolderPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        bucket={bucket}
        initialPrefix={destPrefix}
        onSelect={(prefix) => setDestPrefix(prefix)}
      />
    </>
  )
}
