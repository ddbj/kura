import type { ButtonHTMLAttributes, ReactNode } from "react"

import { cn } from "./cn"

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "aria-label"
> & {
  ariaLabel: string
  children: ReactNode
  size?: number
}

export const IconButton = ({
  ariaLabel,
  children,
  disabled,
  type = "button",
  size = 26,
  ...rest
}: IconButtonProps) => (
  <button
    {...rest}
    type={type}
    aria-label={ariaLabel}
    disabled={disabled || undefined}
    aria-disabled={disabled || undefined}
    className={cn(
      "p-0 bg-transparent border-0 text-ink-mid cursor-pointer rounded-button inline-flex items-center justify-center",
      disabled && "cursor-not-allowed opacity-55",
    )}
    style={{ width: size, height: size }}
  >
    {children}
  </button>
)
