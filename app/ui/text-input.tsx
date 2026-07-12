import type { KeyboardEvent, Ref } from "react"

import { cn } from "./cn"

type Props = {
  ref?: Ref<HTMLInputElement>
  id?: string
  value: string
  onChange: (next: string) => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  error?: boolean
  autoComplete?: string
  spellCheck?: boolean
  type?: "text" | "search"
}

// Handoff .finput: monospaced text input used inside modals / forms.
export const TextInput = ({
  ref,
  id,
  value,
  onChange,
  onKeyDown,
  placeholder,
  ariaLabel,
  disabled,
  error,
  autoComplete,
  spellCheck,
  type = "text",
}: Props) => (
  <input
    ref={ref}
    id={id}
    type={type}
    className={cn("finput", { err: error === true })}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    onKeyDown={onKeyDown}
    placeholder={placeholder}
    aria-label={ariaLabel}
    aria-invalid={error === true ? "true" : undefined}
    disabled={disabled}
    autoComplete={autoComplete ?? "off"}
    spellCheck={spellCheck ?? false}
  />
)
