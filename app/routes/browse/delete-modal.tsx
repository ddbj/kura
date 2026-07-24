import { Button, Icon, Modal } from "~/ui"

type Target = {
  bucket: string
  key: string
  name: string
  size: number
  isPublic?: boolean
}

type Props = {
  open: boolean
  onClose: () => void
  targets: Target[]
  onConfirm: () => void
}

// Delete is destructive — this modal only confirms intent. The actual delete
// runs as a tray operation (enqueueDelete) so progress and partial-failure
// state show up alongside uploads instead of inside the modal.
export const DeleteModal = ({ open, onClose, targets, onConfirm }: Props) => {
  const submit = () => {
    onConfirm()
    onClose()
  }

  const single = targets.length === 1 ? targets[0] : undefined
  const headline = single !== undefined
    ? <>「{single.name}」を削除すると元には戻せません。公開中の場合は公開も止まります。</>
    : <>{targets.length} 件のファイルを削除すると元には戻せません。公開中のファイルは公開も止まります。</>

  return (
    <Modal open={open} onClose={onClose} labelledBy="delete-title">
      <div className="mh">
        <h2 className="mtitle" id="delete-title">ファイルを削除</h2>
      </div>
      <div className="banner red">
        <Icon name="trash" size={15} style={{ color: "var(--red)", flex: "none" }} />
        <div>{headline}</div>
      </div>
      <div className="mfoot">
        <Button onClick={onClose}>キャンセル</Button>
        <Button kind="dangerbox" onClick={submit}>削除</Button>
      </div>
    </Modal>
  )
}
