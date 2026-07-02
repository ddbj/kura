import type { ReactNode } from "react"

import { cn } from "./cn"

type CalloutTone = "info" | "warn" | "ok"

type CalloutProps = {
  children: ReactNode
  tone?: CalloutTone
  role?: "status" | "alert" | "note"
  // Rendered flush-right inside the callout (e.g. a retry button). Keeps the
  // action visually tied to the message rather than floating elsewhere.
  action?: ReactNode
}

const toneClass: Record<CalloutTone, string> = {
  info: "bg-surface-subtle border-border-soft text-ink-mid",
  warn: "bg-warn-bg border-warn-border text-warn-fg",
  ok: "bg-ok-bg border-ok-border text-ok-fg",
}

export const Callout = ({ children, tone = "info", role, action }: CalloutProps) => (
  <div
    role={role}
    className={cn(
      "px-3.5 py-2.5 border rounded-card text-fs-body-sm leading-relaxed",
      toneClass[tone],
    )}
  >
    {action !== undefined
      ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">{children}</div>
          <div className="shrink-0">{action}</div>
        </div>
      )
      : children}
  </div>
)
