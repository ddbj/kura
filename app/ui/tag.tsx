import type { ReactNode } from "react"

import { cn } from "./cn"

type TagSize = "sm" | "md"

type SourceKey = "ddbj" | "dbcls"

type SourceName = "DDBJ" | "DBCLS"

type StatusTone = "critical" | "warning" | "success" | "info"

type TagProps =
  | {
    kind?: "tag"
    size?: TagSize
    mono?: boolean
    children: ReactNode
  }
  | {
    kind: "brand"
    size?: TagSize
    mono?: boolean
    children: ReactNode
  }
  | {
    kind: "source"
    name: SourceName
    source?: undefined
    size?: TagSize
    mono?: boolean
    children?: ReactNode
  }
  | {
    kind: "source"
    source: SourceKey
    name?: undefined
    size?: TagSize
    mono?: boolean
    children?: ReactNode
  }
  | {
    kind: "status"
    tone: StatusTone
    size?: TagSize
    mono?: boolean
    children: ReactNode
  }

const sizeClass: Record<TagSize, string> = {
  sm: "px-2 py-px text-fs-micro",
  md: "px-2.5 py-0.5 text-fs-micro",
}

const sourceClass: Record<SourceName, string> = {
  DDBJ: "bg-src-ddbj-soft text-src-ddbj",
  DBCLS: "bg-src-dbcls-soft text-src-dbcls",
}

const SOURCE_NAME: Record<SourceKey, SourceName> = {
  ddbj: "DDBJ",
  dbcls: "DBCLS",
}

const statusClass: Record<StatusTone, string> = {
  critical: "bg-critical-bg text-critical-fg border border-critical-border",
  warning: "bg-warn-bg text-warn-fg border border-warn-border",
  success: "bg-ok-bg text-ok-fg border border-ok-border",
  info: "bg-brand-soft text-brand-deep",
}

const baseClass =
  "inline-flex items-center rounded-tag font-bold tracking-tag whitespace-nowrap leading-snug"

export const Tag = (props: TagProps) => {
  const { size = "sm", mono = false } = props
  const family = mono ? "font-mono" : "font-sans"

  if (props.kind === "source") {
    const label = props.source !== undefined ? SOURCE_NAME[props.source] : props.name
    return (
      <span className={cn(baseClass, family, sizeClass[size], sourceClass[label])}>
        {props.children ?? label}
      </span>
    )
  }

  if (props.kind === "status") {
    return (
      <span className={cn(baseClass, family, sizeClass[size], statusClass[props.tone])}>
        {props.children}
      </span>
    )
  }

  if (props.kind === "brand") {
    return (
      <span className={cn(baseClass, family, sizeClass[size], "bg-brand-soft text-brand-deep")}>
        {props.children}
      </span>
    )
  }

  return (
    <span
      className={cn(
        baseClass,
        family,
        sizeClass[size],
        "bg-surface-subtle text-ink-mid border border-border-soft",
      )}
    >
      {props.children}
    </span>
  )
}
