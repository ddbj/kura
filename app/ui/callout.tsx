import type { ReactNode } from "react"

import { cn } from "./cn"
import { Icon } from "./icon"

type Tone = "info" | "warn" | "ok" | "red"

type Props = {
  tone: Tone
  children: ReactNode
  className?: string
  role?: "alert" | "status"
}

const iconFor: Record<Tone, "globe" | "clock" | "trash" | "up"> = {
  info: "globe",
  warn: "clock",
  ok: "globe",
  red: "trash",
}

const cls: Record<Tone, string> = {
  info: "banner info",
  warn: "banner ochre",
  ok: "banner ok",
  red: "banner red",
}

// Full-width inline notice — same styling as handoff banners.
export const Callout = ({ tone, children, className, role }: Props) => (
  <div className={cn(cls[tone], className)} role={role}>
    <Icon name={iconFor[tone]} size={15} />
    <div>{children}</div>
  </div>
)
