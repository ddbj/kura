import { useT } from "~/lib/i18n"
import { NameEntryModal } from "~/ui"

type Props = {
  open: boolean
  onClose: () => void
  currentName: string
  siblingNames: readonly string[]
  onConfirm: (newName: string) => void
}

export const FolderRenameModal = ({ open, onClose, currentName, siblingNames, onConfirm }: Props) => {
  const t = useT()

  const validate = (trimmed: string): string | undefined => {
    if (trimmed === "") return t("modal.folderNameRequired")
    if (trimmed.includes("/")) return t("modal.folderNoSlash")
    if (trimmed === currentName) return t("modal.sameName")
    if (siblingNames.includes(trimmed)) return t("modal.alreadyExists", { name: trimmed })

    return undefined
  }

  return (
    <NameEntryModal
      open={open}
      onClose={onClose}
      title={t("modal.folderRenameTitle")}
      labelledBy="folder-rename-title"
      inputId="folder-rename-name"
      inputLabel={t("modal.renameInput")}
      placeholder={t("modal.renameInput")}
      initialName={() => currentName}
      validate={validate}
      onConfirm={onConfirm}
      cancelLabel={t("common.cancel")}
      submitLabel={t("modal.renameSubmit")}
    />
  )
}
