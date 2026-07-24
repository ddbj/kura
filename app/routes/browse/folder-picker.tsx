import { useQuery } from "@tanstack/react-query"
import { Fragment, useEffect, useState } from "react"

import { dirName, listDirectory } from "~/lib/s3"
import { useS3 } from "~/lib/s3/use-s3"
import { Button, Icon, Modal } from "~/ui"

type Props = {
  open: boolean
  onClose: () => void
  bucket: string
  title?: string
  submitLabel?: string
  initialPrefix?: string
  // Prefix of the source folder being moved (or the parent of a file being
  // moved). Descendants of it (or the folder itself) cannot be the destination.
  disabledPrefix?: string | undefined
  onSelect: (prefix: string) => void
}

// Navigate-into picker (Google Drive style): a single click enters a folder,
// the breadcrumb reflects the current location, and the primary button
// commits the current location as the destination — matching how people
// already navigate the browse page. The tree with disclosure carets earlier
// left the "select vs open" distinction ambiguous.
export const FolderPicker = ({
  open,
  onClose,
  bucket,
  title = "移動先のフォルダを選ぶ",
  submitLabel = "この場所を選ぶ",
  initialPrefix = "",
  disabledPrefix,
  onSelect,
}: Props) => {
  const s3 = useS3()
  const [currentPrefix, setCurrentPrefix] = useState<string>(initialPrefix)

  useEffect(() => {
    if (open) setCurrentPrefix(initialPrefix)
  }, [open, initialPrefix])

  const segments = currentPrefix === "" ? [] : currentPrefix.slice(0, -1).split("/")
  const goTo = (upTo: number): void => {
    if (upTo < 0) setCurrentPrefix("")
    else setCurrentPrefix(`${segments.slice(0, upTo + 1).join("/")}/`)
  }
  const enterFolder = (dirPrefix: string): void => setCurrentPrefix(dirPrefix)

  const isCurrentDisabled = disabledPrefix !== undefined
    && disabledPrefix !== ""
    && (currentPrefix === disabledPrefix || currentPrefix.startsWith(disabledPrefix))

  // Share the queryKey with BrowsePage's directory listing so that a new folder
  // created there (which invalidates ["objects", bucket, prefix]) shows up here
  // without the picker holding a stale cache of its own.
  const q = useQuery({
    queryKey: ["objects", bucket, currentPrefix],
    queryFn: () => listDirectory(s3, bucket, currentPrefix),
    enabled: open,
  })

  return (
    <Modal open={open} onClose={onClose} labelledBy="picker-title">
      <div className="mh">
        <h2 className="mtitle" id="picker-title">{title}</h2>
      </div>

      <div className="mdest-label">移動先</div>
      <div className="picker-crumbs" aria-label="移動先">
        {segments.length === 0
          ? <span className="cur">{bucket}</span>
          : <Button unstyled onClick={() => goTo(-1)}>{bucket}</Button>}
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1

          return (
            <Fragment key={i}>
              <span className="sl">/</span>
              {isLast
                ? <span className="cur">{seg}</span>
                : <Button unstyled onClick={() => goTo(i)}>{seg}</Button>}
            </Fragment>
          )
        })}
      </div>

      <PickerList
        q={q}
        disabledPrefix={disabledPrefix}
        onEnter={enterFolder}
      />

      {isCurrentDisabled
        ? <p className="ferr" style={{ marginTop: 10 }}>この場所には移動できません</p>
        : null}

      <div className="mfoot">
        <Button onClick={onClose}>キャンセル</Button>
        <Button
          kind="pri"
          disabled={isCurrentDisabled}
          onClick={() => { onSelect(currentPrefix); onClose() }}
        >
          {submitLabel}
        </Button>
      </div>
    </Modal>
  )
}

type PickerListQuery = ReturnType<typeof useQuery<Awaited<ReturnType<typeof listDirectory>>>>

type PickerListProps = {
  q: PickerListQuery
  disabledPrefix: string | undefined
  onEnter: (dirPrefix: string) => void
}

const PickerList = ({ q, disabledPrefix, onEnter }: PickerListProps) => {
  if (q.isLoading) {
    return <div className="picker-list"><div className="picker-empty">読み込み中…</div></div>
  }
  if (q.isError) {
    return <div className="picker-list"><div className="picker-empty" style={{ color: "var(--red)" }}>取得に失敗しました</div></div>
  }
  const dirs = q.data?.dirs ?? []
  if (dirs.length === 0) {
    return <div className="picker-list"><div className="picker-empty">サブフォルダはありません</div></div>
  }

  return (
    <div className="picker-list" role="list">
      {dirs.map((d) => {
        const name = dirName(d)
        const isDisabled = disabledPrefix !== undefined && disabledPrefix !== ""
          && (d === disabledPrefix || d.startsWith(disabledPrefix))

        return (
          <Button
            key={d}
            unstyled
            role="listitem"
            className="picker-item"
            disabled={isDisabled}
            onClick={() => onEnter(d)}
          >
            <Icon name="folder" size={16} />
            <span className="nm">{name}</span>
            <span className="opencue" aria-hidden="true">開く</span>
            <Icon name="caret" size={12} className="chev" />
          </Button>
        )
      })}
    </div>
  )
}
