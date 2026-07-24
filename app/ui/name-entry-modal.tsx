import { useEffect, useState } from "react"

import { Button } from "./button"
import { Modal } from "./modal"
import { TextInput } from "./text-input"

type Props = {
  open: boolean
  onClose: () => void
  title: string
  // Optional line under the title identifying the target (mono, muted). Use for
  // the current file / folder name; omit when there is no target (e.g. new folder).
  subtitle?: React.ReactNode
  labelledBy: string
  // Rendered above the input, typically shows the target file / folder.
  targetSlot?: React.ReactNode
  // Rendered below the input, typically an inline banner.
  footerSlot?: React.ReactNode
  inputId: string
  inputLabel: string
  placeholder?: string
  // Called once when the modal opens (transition from closed) to seed the
  // input. Any state derived from siblings / current name is captured at that
  // moment — subsequent parent re-renders do not reset the input.
  initialName: () => string
  // Sync validation: return an error message or undefined.
  validate: (name: string) => string | undefined
  // Optional async verification (e.g. HeadObject) run after sync passes; on
  // resolve returns an error message or undefined.
  verify?: (name: string) => Promise<string | undefined>
  // Called when both validate and verify pass. onClose runs after this.
  onConfirm: (name: string) => void | Promise<void>
  submitLabel: string
  busyLabel?: string
}

// Shared shape behind rename / copy / new-folder / folder-rename modals: a
// TextInput seeded on open, Enter submits, error rendered below, footer holds
// キャンセル + primary. Reset is keyed on open transitions only so a parent
// that re-renders during typing does not clobber user input (H-C).
export const NameEntryModal = ({
  open,
  onClose,
  title,
  subtitle,
  labelledBy,
  targetSlot,
  footerSlot,
  inputId,
  inputLabel,
  placeholder,
  initialName,
  validate,
  verify,
  onConfirm,
  submitLabel,
  busyLabel,
}: Props) => {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initialName())
      setError(undefined)
      setBusy(false)
    }
    // initialName is intentionally read only on the open transition — parent
    // re-renders pass a new closure identity each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async () => {
    const trimmed = name.trim()
    const sync = validate(trimmed)
    if (sync !== undefined) {
      setError(sync)

      return
    }
    setBusy(true)
    setError(undefined)
    try {
      if (verify !== undefined) {
        const async = await verify(trimmed)
        if (async !== undefined) {
          setError(async)
          setBusy(false)

          return
        }
      }
      await onConfirm(trimmed)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy={labelledBy}>
      <div className="mh">
        <h2 className="mtitle" id={labelledBy}>{title}</h2>
        {subtitle === undefined ? null : <div className="msubtitle">{subtitle}</div>}
      </div>
      {targetSlot}
      <TextInput
        id={inputId}
        ariaLabel={inputLabel}
        value={name}
        disabled={busy}
        error={error !== undefined}
        {...(placeholder === undefined ? {} : { placeholder })}
        onChange={(next) => {
          setName(next)
          if (error !== undefined) setError(undefined)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            void submit()
          }
        }}
      />
      {error !== undefined ? <p className="ferr" style={{ marginTop: 8 }}>{error}</p> : null}
      {footerSlot}
      <div className="mfoot">
        <Button onClick={onClose} disabled={busy}>キャンセル</Button>
        <Button kind="pri" disabled={busy} onClick={() => void submit()}>
          {busy ? (busyLabel ?? submitLabel) : submitLabel}
        </Button>
      </div>
    </Modal>
  )
}
