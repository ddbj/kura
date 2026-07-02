import type { ReactNode } from "react"

import { cn } from "./cn"

type StableLabelProps = {
  children: ReactNode
  // Every label this slot can show. The widest one reserves the column so a
  // text swap (検索 ↔ 検索中…, Copy ↔ Copied) never resizes the control.
  reserve: readonly string[]
  className?: string
}

// Stacks all possible labels in one centered grid cell and reveals only
// `children`; the hidden siblings hold the cell at its widest width.
export const StableLabel = ({ children, reserve, className }: StableLabelProps) => (
  <span className={cn("grid justify-items-center", className)}>
    {reserve.map((label) => (
      <span key={label} aria-hidden className="col-start-1 row-start-1 invisible">
        {label}
      </span>
    ))}
    <span className="col-start-1 row-start-1">{children}</span>
  </span>
)
