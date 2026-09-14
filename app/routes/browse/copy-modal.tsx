import { HeadObjectCommand } from "@aws-sdk/client-s3"

import { type TFn, useT } from "~/lib/i18n"
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

const parentOf = (key: string): string => {
  const slash = key.lastIndexOf("/")

  return slash === -1 ? "" : key.slice(0, slash + 1)
}

const nameOf = (key: string): string => {
  const slash = key.lastIndexOf("/")

  return slash === -1 ? key : key.slice(slash + 1)
}

const suggestCopyName = (
  name: string,
  siblings: readonly string[],
  t: TFn,
): string => {
  const dot = name.lastIndexOf(".")
  const stem = dot <= 0 ? name : name.slice(0, dot)
  const ext = dot <= 0 ? "" : name.slice(dot)
  let candidate = t("modal.copySuffix", { stem, ext })
  let n = 2
  while (siblings.includes(candidate)) {
    candidate = t("modal.copySuffixNumbered", { stem, ext, n })
    n += 1
  }

  return candidate
}

const httpStatusOf = (err: unknown): number | undefined =>
  typeof err === "object" && err !== null && "$metadata" in err
    ? (err as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode
    : undefined

export const CopyModal = ({ open, onClose, bucket, srcKey, siblingNames, onConfirm }: Props) => {
  const s3 = useS3()
  const t = useT()
  const original = nameOf(srcKey)

  const validate = (trimmed: string): string | undefined => {
    if (trimmed === "") return t("modal.nameRequired")
    if (trimmed.includes("/")) return t("modal.noSlash")
    if (siblingNames.includes(trimmed)) return t("modal.alreadyExists", { name: trimmed })

    return undefined
  }

  const verify = async (trimmed: string): Promise<string | undefined> => {
    const destKey = `${parentOf(srcKey)}${trimmed}`
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: destKey }))

      return t("modal.alreadyExists", { name: trimmed })
    } catch (err) {
      const status = httpStatusOf(err)
      if (status === 404 || status === 403) return undefined
      throw err
    }
  }

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
      onConfirm={(trimmed) => onConfirm(`${parentOf(srcKey)}${trimmed}`)}
      cancelLabel={t("common.cancel")}
      submitLabel={t("common.copy")}
      busyLabel={t("common.checking")}
    />
  )
}
