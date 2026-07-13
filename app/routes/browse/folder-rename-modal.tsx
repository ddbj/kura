import { NameEntryModal } from "~/ui"

type Props = {
  open: boolean
  onClose: () => void
  currentName: string
  siblingNames: readonly string[]
  onConfirm: (newName: string) => void
}

export const FolderRenameModal = ({ open, onClose, currentName, siblingNames, onConfirm }: Props) => {
  const validate = (trimmed: string): string | undefined => {
    if (trimmed === "") return "フォルダ名を入力してください"
    if (trimmed.includes("/")) return "フォルダ名に「/」は使えません"
    if (trimmed === currentName) return "元の名前と同じです"
    if (siblingNames.includes(trimmed)) return `「${trimmed}」は既にあります`

    return undefined
  }

  return (
    <NameEntryModal
      open={open}
      onClose={onClose}
      title="フォルダ名を変更"
      labelledBy="folder-rename-title"
      inputId="folder-rename-name"
      inputLabel="新しい名前"
      placeholder="新しい名前"
      initialName={() => currentName}
      validate={validate}
      onConfirm={onConfirm}
      submitLabel="変更"
    />
  )
}
