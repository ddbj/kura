import type { CSSProperties, TextareaHTMLAttributes } from "react"

import { cn } from "./cn"

type TextAreaState = "default" | "warn"

type TextAreaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "className" | "aria-label" | "aria-describedby" | "aria-invalid"
> & {
  ariaLabel: string
  ariaDescribedby?: string
  state?: TextAreaState
  mono?: boolean
  width?: number
}

export const TextArea = ({
  ariaLabel,
  ariaDescribedby,
  state = "default",
  mono = false,
  width,
  rows = 3,
  ...rest
}: TextAreaProps) => {
  const wrapperStyle: CSSProperties | undefined = width === undefined ? undefined : { width }
  const isWarn = state === "warn"

  return (
    <textarea
      {...rest}
      rows={rows}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedby}
      aria-invalid={isWarn || undefined}
      style={wrapperStyle}
      className={cn(
        "block w-full text-fs-body py-2 px-3 rounded-button font-sans resize-none",
        isWarn
          ? "border border-warn-border bg-warn-bg text-ink"
          : "border border-border-soft bg-surface text-ink",
        mono && "font-mono tracking-mono",
      )}
    />
  )
}
