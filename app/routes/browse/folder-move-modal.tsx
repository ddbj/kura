import { useEffect, useState } from "react"

import { useT } from "~/lib/i18n"
import { Button, Callout, Icon, Modal } from "~/ui"

import { FolderPicker } from "./folder-picker"

type Props = {
  open: boolean
  onClose: () => void
  bucket: string
  // srcPrefix ends with "/" and is the folder being moved.
  srcPrefix: string
  onConfirm: (destParentPrefix: string) => void
}

const parentOfPrefix = (prefix: string): string => {
  if (prefix === "") return ""
  const withoutTrailing = prefix.slice(0, -1)
  const slash = withoutTrailing.lastIndexOf("/")

  return slash === -1 ? "" : withoutTrailing.slice(0, slash + 1)
}

const folderName = (prefix: string): string => {
  const withoutTrailing = prefix.slice(0, -1)
  const slash = withoutTrailing.lastIndexOf("/")

  return slash === -1 ? withoutTrailing : withoutTrailing.slice(slash + 1)
}

export const FolderMoveModal = ({ open, onClose, bucket, srcPrefix, onConfirm }: Props) => {
  const t = useT()
  const initialParent = parentOfPrefix(srcPrefix)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [destParent, setDestParent] = useState<string>(initialParent)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (open) {
      setDestParent(initialParent)
      setError(undefined)
      setPickerOpen(false)
    }
  }, [open, initialParent])

  const submit = () => {
    if (destParent === initialParent) {
      setError(t("modal.destSame"))

      return
    }
    if (destParent === srcPrefix || destParent.startsWith(srcPrefix)) {
      setError(t("modal.intoSelf"))

      return
    }
    onConfirm(destParent)
    onClose()
  }

  const name = folderName(srcPrefix)
  const displayPath = destParent === "" ? bucket : `${bucket}/${destParent.slice(0, -1)}`

  return (
    <>
      <Modal open={open && !pickerOpen} onClose={onClose} labelledBy="folder-move-title">
        <div className="mh">
          <h2 className="mtitle" id="folder-move-title">{t("modal.folderMoveTitle")}</h2>
        </div>
        <div className="mdest">
          <div className="mdest-label">{t("modal.moveFrom")}</div>
          <div className="mdest-row">
            <div className="mdest-path">
              <Icon name="folder" size={14} />
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
        <Callout tone="info">{t("modal.folderMoveNote")}</Callout>
        {error !== undefined ? <p className="ferr" role="alert">{error}</p> : null}
        <div className="mfoot">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button kind="pri" onClick={submit}>{t("modal.moveSubmit")}</Button>
        </div>
      </Modal>
      <FolderPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        bucket={bucket}
        initialPrefix={destParent}
        disabledPrefix={srcPrefix}
        onSelect={(prefix) => setDestParent(prefix)}
      />
    </>
  )
}
