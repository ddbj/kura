import { useEffect, useState } from "react"

import { Button } from "./button"

type CopyFieldProps = {
  value: string
  ariaLabel: string
  copyLabel: string
  copiedLabel: string
}

// Read-only value with a copy-to-clipboard button; the button label flips to
// copiedLabel until the value changes.
export const CopyField = ({ value, ariaLabel, copyLabel, copiedLabel }: CopyFieldProps) => {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setCopied(false)
  }, [value])

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        aria-label={ariaLabel}
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 border border-border-soft rounded-button bg-surface-subtle px-2.5 py-1.5 font-mono text-fs-body-sm text-ink"
      />
      <Button
        kind="secondary"
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => setCopied(true))
        }}
      >
        {copied ? copiedLabel : copyLabel}
      </Button>
    </div>
  )
}
