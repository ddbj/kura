import { useQuery } from "@tanstack/react-query"
import { type ReactNode, useEffect, useState } from "react"

import { dirName, listDirectory } from "~/lib/s3"
import { useS3 } from "~/lib/s3/use-s3"
import { Button, Icon, IconButton, Modal } from "~/ui"

type Props = {
  open: boolean
  onClose: () => void
  bucket: string
  title?: string
  submitLabel?: string
  initialPrefix?: string
  // Prefix of the source folder being moved (or the parent of a file being
  // moved). Descendants of it are disabled because moving into your own
  // subtree makes no sense and would loop.
  disabledPrefix?: string | undefined
  onSelect: (prefix: string) => void
}

const isDescendantOf = (prefix: string, ancestor: string): boolean =>
  ancestor !== "" && prefix.startsWith(ancestor)

export const FolderPicker = ({
  open,
  onClose,
  bucket,
  title = "移動先を選ぶ",
  submitLabel = "選択",
  initialPrefix = "",
  disabledPrefix,
  onSelect,
}: Props) => {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set([""]))
  const [selected, setSelected] = useState<string>(initialPrefix)

  useEffect(() => {
    if (open) {
      setExpanded(new Set([""]))
      setSelected(initialPrefix)
    }
  }, [open, initialPrefix])

  const toggleExpand = (prefix: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(prefix)) next.delete(prefix)
      else next.add(prefix)

      return next
    })
  }

  const renderNode = (prefix: string, name: string, depth: number): ReactNode => {
    const isOpen = expanded.has(prefix)
    const isSelected = prefix === selected
    const isDisabled = disabledPrefix !== undefined && (prefix === disabledPrefix || isDescendantOf(prefix, disabledPrefix))

    return (
      <div key={prefix === "" ? "__root__" : prefix}>
        <div
          className="picker-row"
          style={{
            paddingLeft: depth * 18 + 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 8px",
            borderRadius: 6,
            background: isSelected ? "var(--brandSoft)" : undefined,
            cursor: isDisabled ? "not-allowed" : "pointer",
            opacity: isDisabled ? 0.4 : 1,
          }}
          onClick={() => { if (!isDisabled) setSelected(prefix) }}
        >
          <IconButton
            icon="caret"
            size={10}
            ariaLabel={isOpen ? "折りたたむ" : "展開する"}
            onClick={(event) => { event.stopPropagation(); toggleExpand(prefix) }}
            style={{ transform: isOpen ? "rotate(180deg)" : "rotate(90deg)", transition: "transform 100ms", background: "transparent", border: 0, padding: 2 }}
          />
          <Icon name="folder" size={14} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 12.5, fontWeight: isSelected ? 700 : 500 }}>{name}</span>
        </div>
        {isOpen
          ? <FolderChildren bucket={bucket} prefix={prefix} depth={depth + 1} renderNode={renderNode} />
          : null}
      </div>
    )
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="picker-title">
      <div className="mh">
        <b id="picker-title">{title}</b>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--borderSoft)", borderRadius: 8, padding: 4 }}>
        {renderNode("", bucket, 0)}
      </div>
      <div className="mfoot">
        <Button onClick={onClose}>キャンセル</Button>
        <Button kind="pri" onClick={() => { onSelect(selected); onClose() }}>
          {submitLabel}
        </Button>
      </div>
    </Modal>
  )
}

type ChildrenProps = {
  bucket: string
  prefix: string
  depth: number
  renderNode: (prefix: string, name: string, depth: number) => ReactNode
}

const FolderChildren = ({ bucket, prefix, depth, renderNode }: ChildrenProps) => {
  const s3 = useS3()
  const q = useQuery({
    queryKey: ["folder-picker", bucket, prefix],
    queryFn: () => listDirectory(s3, bucket, prefix),
  })

  if (q.isLoading) {
    return <div style={{ paddingLeft: depth * 18 + 8, padding: "4px 8px", fontSize: 11, color: "var(--inkSoft)" }}>読み込み中…</div>
  }
  if (q.isError) {
    return <div style={{ paddingLeft: depth * 18 + 8, padding: "4px 8px", fontSize: 11, color: "var(--red)" }}>取得に失敗しました</div>
  }
  const dirs = q.data?.dirs ?? []
  if (dirs.length === 0) {
    return <div style={{ paddingLeft: depth * 18 + 8, padding: "4px 8px", fontSize: 11, color: "var(--inkSoft)" }}>(サブフォルダなし)</div>
  }

  return <>{dirs.map((d) => renderNode(d, dirName(d), depth))}</>
}
