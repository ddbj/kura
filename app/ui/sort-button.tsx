import type { ReactNode } from "react"

import { cn } from "./cn"

type Props = {
  active: boolean
  descending: boolean
  align?: "left" | "right"
  onClick: () => void
  children: ReactNode
}

// Column header used in the browse table. Renders the arrow indicator inline.
export const SortButton = ({ active, descending, align = "left", onClick, children }: Props) => (
  <button
    type="button"
    className={cn("sort", { r: align === "right", on: active, desc: active && descending })}
    onClick={onClick}
  >
    {children}
    <svg className="ar" viewBox="0 0 12 12">
      <path d="M6 2.5v7M6 9.5L3.8 7.3M6 9.5l2.2-2.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </button>
)
