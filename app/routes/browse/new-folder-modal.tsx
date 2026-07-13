import { PutObjectCommand } from "@aws-sdk/client-s3"

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

  const validate = (trimmed: string): string | undefined => {
    if (trimmed === "") return "フォルダ名を入力してください"
    if (trimmed.includes("/")) return "フォルダ名に「/」は使えません"
    if (existingNames.includes(trimmed)) return `「${trimmed}」は既にあります`

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
      title="新しいフォルダ"
      labelledBy="newfolder-title"
      inputId="newfolder-name"
      inputLabel="フォルダ名"
      placeholder="フォルダ名"
      initialName={() => ""}
      validate={validate}
      onConfirm={create}
      submitLabel="作成"
      busyLabel="作成中…"
    />
  )
}
