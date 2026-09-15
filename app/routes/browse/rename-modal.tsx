import { useT } from "~/lib/i18n"
import { entryName, keyParent, objectExists } from "~/lib/s3"
import { useS3 } from "~/lib/s3/use-s3"
import { NameEntryModal } from "~/ui"

type Props = {
  open: boolean
  onClose: () => void
  bucket: string
  srcKey: string
  siblingNames: readonly string[]
  onConfirm: (destKey: string) => void
}

export const RenameModal = ({ open, onClose, bucket, srcKey, siblingNames, onConfirm }: Props) => {
  const s3 = useS3()
  const t = useT()
  const currentName = entryName(srcKey)

  const validate = (trimmed: string): string | undefined => {
    if (trimmed === "") return t("modal.nameRequired")
    if (trimmed.includes("/")) return t("modal.noSlash")
    if (trimmed === currentName) return t("modal.sameName")
    if (siblingNames.includes(trimmed)) return t("modal.alreadyExists", { name: trimmed })

    return undefined
  }

  const verify = async (trimmed: string): Promise<string | undefined> =>
    await objectExists(s3, bucket, `${keyParent(srcKey)}${trimmed}`)
      ? t("modal.alreadyExists", { name: trimmed })
      : undefined

  return (
    <NameEntryModal
      open={open}
      onClose={onClose}
      title={t("modal.renameTitle")}
      labelledBy="rename-title"
      inputId="rename-name"
      inputLabel={t("modal.renameInput")}
      placeholder={t("modal.renameInput")}
      initialName={() => currentName}
      validate={validate}
      verify={verify}
      onConfirm={(trimmed) => onConfirm(`${keyParent(srcKey)}${trimmed}`)}
      cancelLabel={t("common.cancel")}
      submitLabel={t("modal.renameSubmit")}
      busyLabel={t("common.checking")}
    />
  )
}
