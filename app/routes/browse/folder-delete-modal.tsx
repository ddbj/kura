import { Button, Icon, Modal } from "~/ui"

type Props = {
  open: boolean
  onClose: () => void
  folderName: string
  onConfirm: () => void
}

// Confirmation only; the recursive delete runs as a tray operation. Shows the
// folder name so accidents ("wait, THAT folder?") are catchable.
export const FolderDeleteModal = ({ open, onClose, folderName, onConfirm }: Props) => {
  const submit = () => {
    onConfirm()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="folder-delete-title">
      <div className="mh">
        <b id="folder-delete-title">フォルダを削除</b>
      </div>
      <div className="lbl" style={{ color: "var(--inkMid)", marginBottom: 6 }}>対象</div>
      <div className="flist">
        <div className="frow">
          <span className="fn"><Icon name="folder" size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />{folderName}</span>
        </div>
      </div>
      <div className="banner red">
        <Icon name="trash" size={15} style={{ color: "var(--red)", flex: "none" }} />
        <div>フォルダとその中身がすべて削除されます。公開中のファイルも公開が止まります。元には戻せません。</div>
      </div>
      <div className="mfoot">
        <Button onClick={onClose}>キャンセル</Button>
        <Button kind="dangerbox" onClick={submit}>削除</Button>
      </div>
    </Modal>
  )
}
