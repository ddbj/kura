import { useEffect, useState } from "react"

import { Button, Icon, Modal } from "~/ui"

import { FolderPicker } from "./folder-picker"

type Props = {
  open: boolean
  onClose: () => void
  bucket: string
  // srcPrefix ends with "/" and is the folder being moved.
  srcPrefix: string
  onConfirm: (destParentPrefix: string) => void
}

const parentOfPrefix = (prefix: string): string => {
  if (prefix === "") return ""
  const withoutTrailing = prefix.slice(0, -1)
  const slash = withoutTrailing.lastIndexOf("/")

  return slash === -1 ? "" : withoutTrailing.slice(0, slash + 1)
}

const folderName = (prefix: string): string => {
  const withoutTrailing = prefix.slice(0, -1)
  const slash = withoutTrailing.lastIndexOf("/")

  return slash === -1 ? withoutTrailing : withoutTrailing.slice(slash + 1)
}

export const FolderMoveModal = ({ open, onClose, bucket, srcPrefix, onConfirm }: Props) => {
  const initialParent = parentOfPrefix(srcPrefix)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [destParent, setDestParent] = useState<string>(initialParent)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (open) {
      setDestParent(initialParent)
      setError(undefined)
      setPickerOpen(false)
    }
  }, [open, initialParent])

  const submit = () => {
    if (destParent === initialParent) {
      setError("移動先が元の場所と同じです")

      return
    }
    if (destParent === srcPrefix || destParent.startsWith(srcPrefix)) {
      setError("自分自身の中には移動できません")

      return
    }
    onConfirm(destParent)
    onClose()
  }

  const name = folderName(srcPrefix)
  const displayPath = destParent === "" ? bucket : `${bucket}/${destParent.slice(0, -1)}`

  return (
    <>
      <Modal open={open && !pickerOpen} onClose={onClose} labelledBy="folder-move-title">
        <div className="mh">
          <h2 className="mtitle" id="folder-move-title">フォルダを移動</h2>
        </div>
        <div className="mdest">
          <div className="mdest-label">移動元</div>
          <div className="mdest-row">
            <div className="mdest-path">
              <Icon name="folder" size={14} />
              <span className="p" title={name}>{name}</span>
            </div>
          </div>
        </div>
        <div className="mdest">
          <div className="mdest-label">移動先</div>
          <div className="mdest-row">
            <div className="mdest-path">
              <Icon name="folder" size={14} />
              <span className="p" title={displayPath}>{displayPath}</span>
            </div>
            <Button kind="po" size="sm" onClick={() => setPickerOpen(true)}>フォルダを選ぶ</Button>
          </div>
        </div>
        <div className="banner ochre">
          <Icon name="clock" size={15} style={{ color: "var(--warnFg)", flex: "none" }} />
          <div>中身の件数が多い場合、移動には時間がかかります。進行状況は右下の操作カードに表示されます。</div>
        </div>
        {error !== undefined ? <p className="ferr">{error}</p> : null}
        <div className="mfoot">
          <Button onClick={onClose}>キャンセル</Button>
          <Button kind="pri" onClick={submit}>移動</Button>
        </div>
      </Modal>
      <FolderPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        bucket={bucket}
        initialPrefix={destParent}
        disabledPrefix={srcPrefix}
        onSelect={(prefix) => setDestParent(prefix)}
      />
    </>
  )
}
