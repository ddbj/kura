import { HeadObjectCommand } from "@aws-sdk/client-s3"

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

const suggestCopyName = (name: string, siblings: readonly string[]): string => {
  const dot = name.lastIndexOf(".")
  const stem = dot <= 0 ? name : name.slice(0, dot)
  const ext = dot <= 0 ? "" : name.slice(dot)
  let candidate = `${stem} のコピー${ext}`
  let n = 2
  while (siblings.includes(candidate)) {
    candidate = `${stem} のコピー (${n})${ext}`
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
  const original = nameOf(srcKey)

  const validate = (trimmed: string): string | undefined => {
    if (trimmed === "") return "名前を入力してください"
    if (trimmed.includes("/")) return "名前に「/」は使えません"
    if (siblingNames.includes(trimmed)) return `「${trimmed}」は既にあります`

    return undefined
  }

  const verify = async (trimmed: string): Promise<string | undefined> => {
    const destKey = `${parentOf(srcKey)}${trimmed}`
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: destKey }))

      return `「${trimmed}」は既にあります`
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
      title="コピー"
      labelledBy="copy-title"
      inputId="copy-name"
      inputLabel="コピー後の名前"
      placeholder="コピー後の名前"
      initialName={() => suggestCopyName(original, siblingNames)}
      validate={validate}
      verify={verify}
      onConfirm={(trimmed) => onConfirm(`${parentOf(srcKey)}${trimmed}`)}
      submitLabel="コピー"
      busyLabel="確認中…"
    />
  )
}
