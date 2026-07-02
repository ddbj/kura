import type { ReactNode } from "react"

import { Heading } from "./heading"

type SectionHeadingProps = {
  children: ReactNode
  subtitle?: ReactNode
  count?: number | undefined
  countSuffix?: string
  action?: ReactNode
  hint?: ReactNode
  as?: "h2" | "h3"
  id?: string
}

export const SectionHeading = ({
  children,
  subtitle,
  count,
  countSuffix,
  action,
  hint,
  as = "h2",
  id,
}: SectionHeadingProps) => (
  <div className="flex flex-col gap-1.5 mb-3">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2.5 min-w-0">
        <Heading as={as} size="h2" bar leading="none" id={id}>
          {children}
        </Heading>
        {count !== undefined && (
          <span className="text-fs-label text-ink-soft font-mono tabular-nums tracking-mono">
            {count}{countSuffix === undefined || countSuffix === "" ? "" : ` ${countSuffix}`}
          </span>
        )}
        {hint}
      </div>
      {action}
    </div>
    {subtitle !== undefined && (
      <p className="text-fs-body-sm text-ink-mid m-0 pl-2.5">{subtitle}</p>
    )}
  </div>
)
