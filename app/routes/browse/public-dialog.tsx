import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useConfig } from "~/lib/config"
import { useT } from "~/lib/i18n"
import { applyPublicState, entryName, publicUrl, publishObject, unpublishObject, useS3 } from "~/lib/s3"
import { Button, Callout, CopyField, Modal, ModalBody, ModalFooter, ModalHeader } from "~/ui"

type PublicDialogProps = {
  bucket: string
  targetKey: string | null
  // Current cached flag for targetKey; undefined while unknown.
  isPublic: boolean | undefined
  onClose: () => void
}

export const PublicDialog = ({ bucket, targetKey, isPublic, onClose }: PublicDialogProps) => {
  const t = useT()
  const config = useConfig()
  const s3 = useS3()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: ({ key, makePublic }: { key: string; makePublic: boolean }) =>
      makePublic ? publishObject(s3, bucket, key) : unpublishObject(s3, bucket, key),
    onSuccess: (_result, { key, makePublic }) => applyPublicState(queryClient, bucket, key, makePublic),
  })

  const url = targetKey === null ? "" : publicUrl(config.publicBase, bucket, targetKey)
  const name = entryName(targetKey ?? "")
  const close = () => {
    mutation.reset()
    onClose()
  }

  return (
    <Modal open={targetKey !== null} onClose={close} ariaLabelledby="public-dialog-title" width={560}>
      <ModalHeader title={t("publish.title")} titleId="public-dialog-title" onClose={close} />
      <ModalBody minHeight={0}>
        {isPublic === undefined
          ? <p className="text-ink-soft">{t("publish.loading")}</p>
          : (
            <div className="flex flex-col gap-3">
              <p>{t(isPublic ? "publish.isPublicIntro" : "publish.makePublicIntro", { name })}</p>
              {isPublic
                ? (
                  <CopyField
                    value={url}
                    ariaLabel={t("publish.publicUrlLabel")}
                    copyLabel={t("common.copy")}
                    copiedLabel={t("common.copied")}
                  />
                )
                : <p className="font-mono text-fs-body-sm text-ink-mid break-all">{url}</p>}
              {mutation.isError ? <Callout tone="warn" role="alert">{t("publish.failed")}</Callout> : null}
            </div>
          )}
      </ModalBody>
      <ModalFooter
        actions={
          <>
            <Button kind="secondary" onClick={close}>{t("common.close")}</Button>
            {isPublic === false && (
              <Button
                disabled={mutation.isPending}
                onClick={() => {
                  if (targetKey !== null) mutation.mutate({ key: targetKey, makePublic: true })
                }}
              >
                {t("publish.makePublic")}
              </Button>
            )}
            {isPublic === true && (
              <Button
                kind="secondary"
                disabled={mutation.isPending}
                onClick={() => {
                  if (targetKey !== null) mutation.mutate({ key: targetKey, makePublic: false })
                }}
              >
                {t("publish.makePrivate")}
              </Button>
            )}
          </>
        }
      />
    </Modal>
  )
}
