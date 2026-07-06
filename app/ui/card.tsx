import type { ReactNode } from "react"

import { cn } from "./cn"

type CardTone = "surface" | "subtle"

type CardProps = {
  children: ReactNode
  // "section" when the card is itself a labelled landmark (pair with
  // aria-labelledby); plain "div" otherwise.
  as?: "div" | "section"
  tone?: CardTone
  padding?: "none" | "sm" | "md"
  className?: string
  id?: string
  "aria-labelledby"?: string
  "aria-label"?: string
}

const toneClass: Record<CardTone, string> = {
  surface: "bg-surface",
  subtle: "bg-surface-subtle",
}

const paddingClass: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "",
  sm: "p-4",
  md: "p-6",
}

// Generic bordered container shared by the object table, inline action
// panels, and the landing use-case cards. Stays at shadow-card at rest;
// callers add shadow-card-hover themselves where a hover lift makes sense
// (interactive cards only, not static panels).
export const Card = ({
  children,
  as: Tag = "div",
  tone = "surface",
  padding = "none",
  className,
  id,
  "aria-labelledby": ariaLabelledby,
  "aria-label": ariaLabel,
}: CardProps) => (
  <Tag
    id={id}
    aria-labelledby={ariaLabelledby}
    aria-label={ariaLabel}
    className={cn(
      "rounded-card border border-border-soft shadow-card",
      toneClass[tone],
      paddingClass[padding],
      className,
    )}
  >
    {children}
  </Tag>
)
