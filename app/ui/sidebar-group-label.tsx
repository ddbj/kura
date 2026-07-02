import type { ReactNode } from "react"

type SidebarGroupLabelProps = {
  children: ReactNode
  action?: ReactNode
}

export const SidebarGroupLabel = ({ children, action }: SidebarGroupLabelProps) => (
  <div className="flex items-center justify-between mb-2">
    <div className="text-fs-label font-bold text-ink-mid tracking-label">
      {children}
    </div>
    {action}
  </div>
)
