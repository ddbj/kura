import { useT } from "~/lib/i18n"
import { Button, Icon, Modal } from "~/ui"

type Target = {
  bucket: string
  key: string
  name: string
  size: number
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
  const t = useT()
  const submit = () => {
    onConfirm()
    onClose()
  }

  const single = targets.length === 1 ? targets[0] : undefined
  const headline = single !== undefined
    ? t("modal.deleteBodyOne", { name: single.name })
    : t("modal.deleteBodyMany", { n: targets.length })

  return (
    <Modal open={open} onClose={onClose} labelledBy="delete-title">
      <div className="mh">
        <h2 className="mtitle" id="delete-title">{t("modal.deleteTitle")}</h2>
      </div>
      <div className="banner red">
        <Icon name="trash" size={15} style={{ color: "var(--red)", flex: "none" }} />
        <div>{headline}</div>
      </div>
      <div className="mfoot">
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button kind="dangerbox" onClick={submit}>{t("common.delete")}</Button>
      </div>
    </Modal>
  )
}
