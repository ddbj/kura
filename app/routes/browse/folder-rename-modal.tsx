import { useEffect, useState } from "react"

import { Button, Modal, TextInput } from "~/ui"

type Props = {
  open: boolean
  onClose: () => void
  currentName: string
  siblingNames: readonly string[]
  onConfirm: (newName: string) => void
}

const validate = (name: string, current: string, siblings: readonly string[]): string | undefined => {
  const trimmed = name.trim()
  if (trimmed === "") return "フォルダ名を入力してください"
  if (trimmed.includes("/")) return "フォルダ名に「/」は使えません"
  if (trimmed === current) return "元の名前と同じです"
  if (siblings.includes(trimmed)) return `「${trimmed}」は既にあります`

  return undefined
}

export const FolderRenameModal = ({ open, onClose, currentName, siblingNames, onConfirm }: Props) => {
  const [name, setName] = useState(currentName)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (open) {
      setName(currentName)
      setError(undefined)
    }
  }, [open, currentName])

  const submit = () => {
    const trimmed = name.trim()
    const validationError = validate(trimmed, currentName, siblingNames)
    if (validationError !== undefined) {
      setError(validationError)

      return
    }
    onConfirm(trimmed)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="folder-rename-title">
      <div className="mh">
        <b id="folder-rename-title">フォルダ名を変更</b>
      </div>
      <div className="field">
        <label className="flabel" htmlFor="folder-rename-name">新しい名前</label>
        <TextInput
          id="folder-rename-name"
          value={name}
          error={error !== undefined}
          onChange={(next) => { setName(next); if (error !== undefined) setError(undefined) }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              submit()
            }
          }}
        />
        {error !== undefined ? <p className="ferr">{error}</p> : null}
      </div>
      <div className="mfoot">
        <Button onClick={onClose}>キャンセル</Button>
        <Button kind="pri" onClick={submit}>変更</Button>
      </div>
    </Modal>
  )
}
