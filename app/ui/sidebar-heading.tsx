import type { ReactNode } from "react"

import { cn } from "./cn"
import { Heading } from "./heading"

type SidebarHeadingProps = {
  children: ReactNode
  action?: ReactNode
  as?: "h2" | "h3"
  id?: string
  withDivider?: boolean
}

export const SidebarHeading = ({
  children,
  action,
  as = "h3",
  id,
  withDivider = false,
}: SidebarHeadingProps) => (
  <div
    className={cn(
      "flex items-center justify-between gap-2",
      withDivider && "border-b border-border-soft py-2.5 min-h-heading-row",
    )}
  >
    <Heading as={as} size="h3" bar id={id}>
      {children}
    </Heading>
    {action}
  </div>
)
