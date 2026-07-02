import type { ReactNode } from "react"
import { createElement } from "react"

import { cn } from "./cn"

type HeadingScale = "h1" | "h2" | "h3"

type HeadingProps = {
  children: ReactNode
  // Outline level (the rendered element). `size` controls the visual scale
  // independently, so an h3 in the document outline can still read at the h2
  // scale where the layout calls for it.
  as?: HeadingScale
  size?: HeadingScale
  // Brand left bar. Marks a section / document heading; card and panel titles
  // leave it off.
  bar?: boolean
  // Line-box treatment. `tight` (default) keeps a comfortable leading for
  // block use. `none` strips the leading so a heading placed next to smaller
  // sibling text in a flex row visually centers on the sibling's optical
  // center (Latin cap-height sits above the flex center under a wider
  // line-box).
  leading?: "tight" | "none"
  id?: string | undefined
  className?: string
}

// Single source of the heading recipe: ink color and leading are fixed here
// so every page, section, and card title shares one rhythm. Weight is
// per-scale (h1 = extrabold for page titles, h2 / h3 = bold). Result and news
// item titles are a separate, looser recipe (leading-snug) and do not use this.
const scaleClass: Record<HeadingScale, string> = {
  h1: "text-fs-h1 tracking-h1 font-extrabold",
  h2: "text-fs-h2 font-bold",
  h3: "text-fs-h3 tracking-h3 font-bold",
}

const leadingClass: Record<NonNullable<HeadingProps["leading"]>, string> = {
  tight: "leading-tight",
  none: "leading-none",
}

export const Heading = (
  { children, as = "h2", size, bar = false, leading = "tight", id, className }: HeadingProps,
) =>
  createElement(
    as,
    {
      id,
      className: cn(
        "text-ink m-0",
        leadingClass[leading],
        scaleClass[size ?? as],
        bar && "pl-2.5 border-l-[3px] border-brand",
        className,
      ),
    },
    children,
  )
