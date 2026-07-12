import type { ReactNode } from "react"

import { cn } from "./cn"

export type ModeOption<T extends string> = {
  value: T
  label: ReactNode
}

type Props<T extends string> = {
  value: T
  options: readonly ModeOption<T>[]
  onChange: (next: T) => void
  ariaLabel?: string
}

// Handoff .modeswitch: pair-of-tabs pill inside modal headers.
export const ModeSwitch = <T extends string>({ value, options, onChange, ariaLabel }: Props<T>) => (
  <div className="modeswitch" role="tablist" aria-label={ariaLabel}>
    {options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        role="tab"
        aria-selected={opt.value === value}
        className={cn({ on: opt.value === value })}
        onClick={() => onChange(opt.value)}
      >
        {opt.label}
      </button>
    ))}
  </div>
)
