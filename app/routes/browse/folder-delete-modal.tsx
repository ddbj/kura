import { useT } from "~/lib/i18n"
import { Button, Callout, Modal } from "~/ui"

type Props = {
  open: boolean
  onClose: () => void
  folderName: string
  onConfirm: () => void
}

// Confirmation only; the recursive delete runs as a tray operation. Folder
// name is spelled out in the banner so accidents ("wait, THAT folder?")
// remain catchable without a dedicated target box.
export const FolderDeleteModal = ({ open, onClose, folderName, onConfirm }: Props) => {
  const t = useT()
  const submit = () => {
    onConfirm()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="folder-delete-title">
      <div className="mh">
        <h2 className="mtitle" id="folder-delete-title">{t("modal.folderDeleteTitle")}</h2>
      </div>
      <Callout tone="red" icon="trash">{t("modal.folderDeleteBody", { name: folderName })}</Callout>
      <div className="mfoot">
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button kind="dangerbox" onClick={submit}>{t("common.delete")}</Button>
      </div>
    </Modal>
  )
}
