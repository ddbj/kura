import { Button, Icon, Modal } from "~/ui"

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
  const submit = () => {
    onConfirm()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="folder-delete-title">
      <div className="mh">
        <h2 className="mtitle" id="folder-delete-title">フォルダを削除</h2>
      </div>
      <div className="banner red">
        <Icon name="trash" size={15} style={{ color: "var(--red)", flex: "none" }} />
        <div>フォルダ「{folderName}」とその中身がすべて削除されます。公開中のファイルも公開が止まります。元には戻せません。</div>
      </div>
      <div className="mfoot">
        <Button onClick={onClose}>キャンセル</Button>
        <Button kind="dangerbox" onClick={submit}>削除</Button>
      </div>
    </Modal>
  )
}
