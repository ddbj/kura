import type { MouseEventHandler, ReactNode } from "react"
import { Link, type To } from "react-router"

import { cn } from "./cn"

type ChipBase = {
  children: ReactNode
  kind?: "filter" | "example"
  mono?: boolean
  selected?: boolean
}

type ChipProps =
  | (ChipBase & { as?: "a"; to: To; onClick?: never })
  | (ChipBase & { as: "button"; onClick?: MouseEventHandler<HTMLButtonElement>; to?: never })

const baseClass =
  "inline-flex items-center gap-1 px-3 py-1 rounded-pill border text-fs-label leading-snug font-medium no-underline cursor-pointer"

const stateClass = ({ kind, selected }: { kind: "filter" | "example"; selected: boolean }) => {
  if (kind === "filter" && selected) {
    return "bg-brand-soft text-brand-deep border-brand/35"
  }
  return "bg-surface-subtle text-ink-mid border-border-soft"
}

export const Chip = (props: ChipProps) => {
  const { children, kind = "filter", mono = false, selected = false } = props
  const family = mono ? "font-mono" : "font-sans"
  const className = cn(baseClass, family, stateClass({ kind, selected }))

  if (props.as === "button") {
    return (
      <button type="button" onClick={props.onClick} className={className}>
        {children}
      </button>
    )
  }

  return (
    <Link to={props.to} className={className}>
      {children}
    </Link>
  )
}
