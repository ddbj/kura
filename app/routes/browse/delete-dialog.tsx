import { useT } from "~/lib/i18n"
import { entryName } from "~/lib/s3"
import { Button, Callout, Modal, ModalBody, ModalFooter, ModalHeader } from "~/ui"

type DeleteDialogProps = {
  targetKey: string | null
  deleting: boolean
  failed: boolean
  onConfirm: () => void
  onCancel: () => void
}

export const DeleteDialog = ({ targetKey, deleting, failed, onConfirm, onCancel }: DeleteDialogProps) => {
  const t = useT()
  return (
    <Modal
      open={targetKey !== null}
      onClose={onCancel}
      ariaLabelledby="delete-dialog-title"
      width={480}
      closeOnEscape={!deleting}
      closeOnOverlay={!deleting}
    >
      <ModalHeader
        title={t("browse.deleteConfirmTitle")}
        titleId="delete-dialog-title"
        onClose={onCancel}
        closeLabel={t("common.close")}
      />
      <ModalBody minHeight={0}>
        <p>{t("browse.deleteConfirmBody", { name: entryName(targetKey ?? "") })}</p>
        {failed ? (
          <div className="mt-3">
            <Callout tone="warn" role="alert">{t("browse.deleteErrorTitle")}</Callout>
          </div>
        ) : null}
      </ModalBody>
      <ModalFooter
        actions={
          <>
            <Button kind="secondary" onClick={onCancel} disabled={deleting}>{t("common.cancel")}</Button>
            <Button kind="danger" onClick={onConfirm} disabled={deleting}>{t("browse.delete")}</Button>
          </>
        }
      />
    </Modal>
  )
}
