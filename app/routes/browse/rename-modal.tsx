import { HeadObjectCommand } from "@aws-sdk/client-s3"

import { useT } from "~/lib/i18n"
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

const httpStatusOf = (err: unknown): number | undefined =>
  typeof err === "object" && err !== null && "$metadata" in err
    ? (err as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode
    : undefined

export const RenameModal = ({ open, onClose, bucket, srcKey, siblingNames, onConfirm }: Props) => {
  const s3 = useS3()
  const t = useT()
  const currentName = nameOf(srcKey)

  const validate = (trimmed: string): string | undefined => {
    if (trimmed === "") return t("modal.nameRequired")
    if (trimmed.includes("/")) return t("modal.noSlash")
    if (trimmed === currentName) return t("modal.sameName")
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
      title={t("modal.renameTitle")}
      labelledBy="rename-title"
      inputId="rename-name"
      inputLabel={t("modal.renameInput")}
      placeholder={t("modal.renameInput")}
      initialName={() => currentName}
      validate={validate}
      verify={verify}
      onConfirm={(trimmed) => onConfirm(`${parentOf(srcKey)}${trimmed}`)}
      cancelLabel={t("common.cancel")}
      submitLabel={t("modal.renameSubmit")}
      busyLabel={t("common.checking")}
    />
  )
}
