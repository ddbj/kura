import type { ReactNode } from "react"

import { cn } from "./cn"

type Props = {
  onClick: () => void
  children: ReactNode
  danger?: boolean
  className?: string
}

// Menu row inside .rowmenu / .uploadmenu / .usermenu.
export const MenuItem = ({ onClick, children, danger, className }: Props) => (
  <button
    type="button"
    role="menuitem"
    className={cn({ del: danger === true }, className)}
    onClick={onClick}
  >
    {children}
  </button>
)
