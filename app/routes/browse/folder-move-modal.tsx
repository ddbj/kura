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
          <b id="folder-move-title">フォルダを移動</b>
        </div>
        <div className="field">
          <label className="flabel">対象フォルダ</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink)", padding: "6px 0" }}>
            <Icon name="folder" size={16} />
            <span>{name}</span>
          </div>
        </div>
        <div className="field">
          <label className="flabel">移動先</label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontFamily: "var(--mono)",
              fontSize: 12.5,
            }}>
              <Icon name="folder" size={14} />
              <span title={displayPath} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayPath}</span>
            </div>
            <Button kind="po" size="sm" onClick={() => setPickerOpen(true)}>選ぶ…</Button>
          </div>
          {error !== undefined ? <p className="ferr">{error}</p> : null}
        </div>
        <div className="banner ochre">
          <Icon name="clock" size={15} style={{ color: "var(--warnFg)", flex: "none" }} />
          <div>中身の件数が多い場合、移動には時間がかかります。進行状況は右下の操作カードに表示されます。</div>
        </div>
        <div className="mfoot">
          <Button onClick={onClose}>キャンセル</Button>
          <Button kind="pri" onClick={submit}>移動</Button>
        </div>
      </Modal>
      <FolderPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        bucket={bucket}
        title="移動先のフォルダを選ぶ"
        submitLabel="選択"
        initialPrefix={destParent}
        disabledPrefix={srcPrefix}
        onSelect={(prefix) => setDestParent(prefix)}
      />
    </>
  )
}
