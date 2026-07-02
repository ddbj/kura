import type { ReactNode } from "react"
import { useRef } from "react"

import type { ButtonSize, SizedButtonKind } from "./button"
import { Button } from "./button"

type FilePickButtonProps = {
  onPick: (files: File[]) => void
  children: ReactNode
  multiple?: boolean
  kind?: SizedButtonKind
  size?: ButtonSize
}

// A Button that opens the native file picker; the input itself stays visually
// hidden and out of the tab order.
export const FilePickButton = ({ onPick, children, multiple = true, kind, size }: FilePickButtonProps) => {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple || undefined}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])]
          // Reset so picking the same file again still fires onChange.
          event.currentTarget.value = ""
          if (files.length > 0) onPick(files)
        }}
      />
      <Button
        {...(kind === undefined ? {} : { kind })}
        {...(size === undefined ? {} : { size })}
        onClick={() => inputRef.current?.click()}
      >
        {children}
      </Button>
    </>
  )
}
