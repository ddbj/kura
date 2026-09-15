import { useEffect, useState } from "react"

import { useT } from "~/lib/i18n"
import { entryName, keyParent, objectExists } from "~/lib/s3"
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

export const MoveModal = ({ open, onClose, bucket, srcKey, onConfirm }: Props) => {
  const s3 = useS3()
  const t = useT()
  const initialParent = keyParent(srcKey)
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

  const name = entryName(srcKey)

  const submit = async () => {
    if (destPrefix === initialParent) {
      setError(t("modal.destSame"))

      return
    }
    const destKey = `${destPrefix}${name}`
    setBusy(true)
    try {
      if (await objectExists(s3, bucket, destKey)) {
        setError(t("modal.destAlreadyExists", { name }))
        setBusy(false)

        return
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
          <h2 className="mtitle" id="move-title">{t("modal.moveTitle")}</h2>
        </div>
        <div className="mdest">
          <div className="mdest-label">{t("modal.moveFrom")}</div>
          <div className="mdest-row">
            <div className="mdest-path">
              <Icon name="file" size={14} />
              <span className="p" title={name}>{name}</span>
            </div>
          </div>
        </div>
        <div className="mdest">
          <div className="mdest-label">{t("modal.moveTo")}</div>
          <div className="mdest-row">
            <div className="mdest-path">
              <Icon name="folder" size={14} />
              <span className="p" title={displayPath}>{displayPath}</span>
            </div>
            <Button kind="po" size="sm" onClick={() => setPickerOpen(true)}>{t("modal.moveChoose")}</Button>
          </div>
        </div>
        {error !== undefined ? <p className="ferr" role="alert">{error}</p> : null}
        <div className="mfoot">
          <Button onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button kind="pri" disabled={busy} onClick={() => void submit()}>
            {busy ? t("common.checking") : t("modal.moveSubmit")}
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
