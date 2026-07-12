import type { ReactNode } from "react"

import { cn } from "./cn"

type TagTone = "ok" | "warn" | "neutral" | "run" | "fail"

type Props = {
  tone: TagTone
  dot?: boolean
  children: ReactNode
  className?: string
}

const cls: Record<TagTone, string> = {
  ok: "tag ok",
  warn: "tag warn",
  neutral: "tag neutral",
  run: "tag run",
  fail: "tag fail",
}

export const Tag = ({ tone, dot, children, className }: Props) => (
  <span className={cn(cls[tone], { dot: dot === true }, className)}>{children}</span>
)
