import type { ReactNode } from "react"

import { cn } from "./cn"
import { ChevronDownIcon } from "./icons"
import { SidebarGroupLabel } from "./sidebar-group-label"

type FacetGroupProps = {
  label: string
  appliedCount?: number
  onClear?: () => void
  clearLabel?: string
  showMore?: boolean
  showMoreLabel?: string
  expanded?: boolean
  onShowMore?: () => void
  children: ReactNode
}

export const FacetGroup = ({
  label,
  appliedCount = 0,
  onClear,
  clearLabel = "解除",
  showMore = false,
  showMoreLabel = "さらに表示",
  expanded = false,
  onShowMore,
  children,
}: FacetGroupProps) => (
  <div>
    <SidebarGroupLabel
      action={
        appliedCount > 0 && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="bg-transparent border-0 text-brand text-fs-micro font-semibold cursor-pointer p-0 font-sans"
          >
            {clearLabel}
          </button>
        )
      }
    >
      {label}
    </SidebarGroupLabel>
    <ul className="list-none p-0 m-0">{children}</ul>
    {showMore && (
      <button
        type="button"
        onClick={onShowMore}
        aria-expanded={expanded}
        className="bg-transparent border-0 text-brand text-fs-label cursor-pointer pt-1.5 font-semibold font-sans inline-flex items-center gap-1"
      >
        <ChevronDownIcon size={11} aria-hidden className={cn("transition-transform", expanded && "rotate-180")} />
        <span className="min-w-20 text-left">{showMoreLabel}</span>
      </button>
    )}
  </div>
)
