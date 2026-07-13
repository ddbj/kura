import { formatBytes } from "~/lib/format"
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

  return (
    <Modal open={open} onClose={onClose} labelledBy="delete-title">
      <div className="mh">
        <b id="delete-title">ファイルを削除</b>
      </div>
      <div className="lbl" style={{ color: "var(--inkMid)", marginBottom: 6 }}>対象 {targets.length}件</div>
      <div className="flist">
        {targets.map((t) => (
          <div className="frow" key={`${t.bucket}/${t.key}`}>
            <span className="fn" title={t.key}>
              {t.name}
              {t.isPublic === true
                ? <span className="pubmark"><span className="d" />公開中</span>
                : null}
            </span>
            <span className="fmeta">{formatBytes(t.size)}</span>
          </div>
        ))}
      </div>
      <div className="banner red">
        <Icon name="trash" size={15} style={{ color: "var(--red)", flex: "none" }} />
        <div>削除するとすぐに消え、元には戻せません。公開中のファイルは公開も止まります。</div>
      </div>
      <div className="mfoot">
        <Button onClick={onClose}>キャンセル</Button>
        <Button kind="dangerbox" onClick={submit}>削除</Button>
      </div>
    </Modal>
  )
}
