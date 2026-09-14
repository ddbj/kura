import { PutObjectCommand } from "@aws-sdk/client-s3"

import { useT } from "~/lib/i18n"
import { useS3 } from "~/lib/s3/use-s3"
import { NameEntryModal } from "~/ui"

type Props = {
  open: boolean
  onClose: () => void
  bucket: string
  prefix: string
  existingNames: readonly string[]
  onCreated: () => void | Promise<void>
}

export const NewFolderModal = ({ open, onClose, bucket, prefix, existingNames, onCreated }: Props) => {
  const s3 = useS3()
  const t = useT()

  const validate = (trimmed: string): string | undefined => {
    if (trimmed === "") return t("modal.folderNameRequired")
    if (trimmed.includes("/")) return t("modal.folderNoSlash")
    if (existingNames.includes(trimmed)) return t("modal.alreadyExists", { name: trimmed })

    return undefined
  }

  const create = async (trimmed: string): Promise<void> => {
    const key = `${prefix}${trimmed}/.keep`
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: new Uint8Array(0) }))
    await onCreated()
  }

  return (
    <NameEntryModal
      open={open}
      onClose={onClose}
      title={t("modal.newFolderTitle")}
      labelledBy="newfolder-title"
      inputId="newfolder-name"
      inputLabel={t("modal.newFolderInput")}
      placeholder={t("modal.newFolderInput")}
      initialName={() => ""}
      validate={validate}
      onConfirm={create}
      cancelLabel={t("common.cancel")}
      submitLabel={t("modal.newFolderSubmit")}
      busyLabel={t("modal.newFolderBusy")}
    />
  )
}
