import type { ReactNode } from "react"

import { Button } from "./button"
import { cn } from "./cn"
import { Icon, type IconName } from "./icon"

type Tone = "info" | "warn" | "ok" | "red"

type Props = {
  tone: Tone
  children: ReactNode
  // Left icon override. Defaults per tone (see `iconFor`); use this when a
  // more specific glyph carries the meaning better (e.g. "trash" on a delete
  // confirmation, "up" on the over-quota bar).
  icon?: IconName
  // Right-side action(s), e.g. a retry button. Rendered before the dismiss
  // button when both are present.
  actions?: ReactNode
  className?: string
  role?: "alert" | "status"
}

// The × button carries no text, so its label is not optional: pairing the two
// in a union makes "dismissable without a label" unrepresentable.
type DismissProps =
  | { onDismiss: () => void; dismissAriaLabel: string }
  | { onDismiss?: undefined; dismissAriaLabel?: undefined }

// Matches the tone semantics of the stylesheet: ochre marks something
// time-limited, red marks a failure or a destructive outcome.
const iconFor: Record<Tone, IconName> = {
  info: "info",
  warn: "clock",
  ok: "check",
  red: "alert",
}

const cls: Record<Tone, string> = {
  info: "banner info",
  warn: "banner ochre",
  ok: "banner ok",
  red: "banner red",
}

// Full-width inline notice. Structure is always `[icon] [body] [actions]` so
// bars have a consistent height and the right slot always aligns to center
// regardless of whether actions/close exist.
export const Callout = ({
  tone,
  children,
  icon,
  actions,
  onDismiss,
  dismissAriaLabel,
  className,
  role,
}: Props & DismissProps) => {
  const hasRight = actions !== undefined || onDismiss !== undefined

  return (
    <div className={cn(cls[tone], className)} role={role}>
      <Icon name={icon ?? iconFor[tone]} size={15} />
      <div className="banner-body">{children}</div>
      {hasRight
        ? (
          <div className="banner-actions">
            {actions}
            {onDismiss !== undefined
              ? (
                <Button unstyled className="banner-close" onClick={onDismiss} aria-label={dismissAriaLabel}>
                  <Icon name="x" size={14} />
                </Button>
              )
              : null}
          </div>
        )
        : null}
    </div>
  )
}
