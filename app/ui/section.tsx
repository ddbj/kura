import type { ReactNode } from "react"

import { cn } from "./cn"

type SectionPad = "sm" | "mid" | "md" | "lg"

type SectionProps = {
  children: ReactNode
  padTop?: SectionPad
  padBottom?: SectionPad
  narrow?: boolean
  className?: string
}

const padTopClass: Record<SectionPad, string> = {
  sm: "pt-section-sm",
  mid: "pt-section-mid",
  md: "pt-section-md",
  lg: "pt-section-lg",
}

const padBottomClass: Record<SectionPad, string> = {
  sm: "pb-section-sm",
  mid: "pb-section-mid",
  md: "pb-section-md",
  lg: "pb-section-lg",
}

// Every page-level block goes through Section so page width / gutter stay
// consistent; `narrow` swaps the inner max-width for reading-width content
// (hero copy, forms) instead of the full page width.
export const Section = ({ children, padTop = "md", padBottom = "md", narrow = false, className }: SectionProps) => (
  <div className={cn("px-page-gutter", padTopClass[padTop], padBottomClass[padBottom], className)}>
    <div className={cn("mx-auto", narrow ? "max-w-content-narrow" : "max-w-content-max")}>
      {children}
    </div>
  </div>
)
