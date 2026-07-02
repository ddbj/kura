import type { CSSProperties, ReactNode } from "react"

import { cn } from "./cn"

type SectionPad = "none" | "sm" | "mid" | "block" | "md" | "lg"

type SectionProps = {
  children: ReactNode
  padTop?: SectionPad
  padBottom?: SectionPad
  padY?: "sm" | "md" | "lg"
  maxWidth?: number
}

const padTopClass: Record<SectionPad, string> = {
  none: "pt-0",
  sm: "pt-section-sm",
  mid: "pt-section-mid",
  block: "pt-section-block",
  md: "pt-section-md",
  lg: "pt-section-lg",
}

const padBottomClass: Record<SectionPad, string> = {
  none: "pb-0",
  sm: "pb-section-sm",
  mid: "pb-section-mid",
  block: "pb-section-block",
  md: "pb-section-md",
  lg: "pb-section-lg",
}

const padYToPad: Record<"sm" | "md" | "lg", SectionPad> = {
  sm: "sm",
  md: "md",
  lg: "lg",
}

export const Section = ({ children, padTop, padBottom, padY, maxWidth }: SectionProps) => {
  const inner: CSSProperties | undefined = maxWidth === undefined ? undefined : { maxWidth }
  const fallback: SectionPad = padY === undefined ? "md" : padYToPad[padY]
  const top = padTop ?? fallback
  const bottom = padBottom ?? fallback

  return (
    <section className={cn("px-page-gutter", padTopClass[top], padBottomClass[bottom])}>
      <div className="max-w-content-max mx-auto" style={inner}>
        {children}
      </div>
    </section>
  )
}
