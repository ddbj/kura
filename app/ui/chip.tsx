import type { ReactNode } from "react"

import { cn } from "./cn"

type Props = {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  className?: string
  ariaLabel?: string
}

export const Chip = ({ active, onClick, children, className, ariaLabel }: Props) => (
  <button
    type="button"
    className={cn("chip", { on: active === true }, className)}
    aria-pressed={active === true ? "true" : undefined}
    aria-label={ariaLabel}
    onClick={onClick}
  >
    {children}
  </button>
)
