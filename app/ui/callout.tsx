import type { ReactNode } from "react"

import { Button } from "./button"
import { cn } from "./cn"
import { Icon, type IconName } from "./icon"

type Tone = "info" | "warn" | "ok" | "red"

type Props = {
  tone: Tone
  children: ReactNode
  // Left icon override. Defaults per tone (see `iconFor`); use this when the
  // default doesn't fit the meaning (e.g. over-quota is a red banner but the
  // "trash" default reads as delete).
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

const iconFor: Record<Tone, IconName> = {
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
