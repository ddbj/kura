import type { ReactNode } from "react"

import { cn } from "./cn"

type Option<T extends string | number> = {
  value: T
  label: ReactNode
}

type Props<T extends string | number> = {
  value: T
  options: readonly Option<T>[]
  onChange: (next: T) => void
  ariaLabel?: string
}

// Handoff .seg: chip-style segmented buttons (share-modal TTL selector).
export const Segmented = <T extends string | number>({ value, options, onChange, ariaLabel }: Props<T>) => (
  <div className="seg" role="tablist" aria-label={ariaLabel}>
    {options.map((opt) => (
      <button
        key={String(opt.value)}
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
