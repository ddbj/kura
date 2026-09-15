import { type TFn, useT } from "~/lib/i18n"
import { entryName, keyParent, objectExists, splitExtension } from "~/lib/s3"
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

const suggestCopyName = (
  name: string,
  siblings: readonly string[],
  t: TFn,
): string => {
  const { stem, ext } = splitExtension(name)
  let candidate = t("modal.copySuffix", { stem, ext })
  let n = 2
  while (siblings.includes(candidate)) {
    candidate = t("modal.copySuffixNumbered", { stem, ext, n })
    n += 1
  }

  return candidate
}

export const CopyModal = ({ open, onClose, bucket, srcKey, siblingNames, onConfirm }: Props) => {
  const s3 = useS3()
  const t = useT()
  const original = entryName(srcKey)

  const validate = (trimmed: string): string | undefined => {
    if (trimmed === "") return t("modal.nameRequired")
    if (trimmed.includes("/")) return t("modal.noSlash")
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
      title={t("modal.copyTitle")}
      labelledBy="copy-title"
      inputId="copy-name"
      inputLabel={t("modal.copyInput")}
      placeholder={t("modal.copyInput")}
      initialName={() => suggestCopyName(original, siblingNames, t)}
      validate={validate}
      verify={verify}
      onConfirm={(trimmed) => onConfirm(`${keyParent(srcKey)}${trimmed}`)}
      cancelLabel={t("common.cancel")}
      submitLabel={t("common.copy")}
      busyLabel={t("common.checking")}
    />
  )
}
