import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react"

import { cn } from "./cn"

type SizedButtonKind = "primary" | "secondary" | "danger" | "ghost" | "accent"
type ButtonKind = SizedButtonKind | "link"
type ButtonSize = "sm" | "md" | "lg"

type SizedStyleProps = {
  kind?: SizedButtonKind
  size?: ButtonSize
  block?: boolean
  pill?: boolean
}

type LinkStyleProps = {
  kind: "link"
  size?: never
  block?: never
  pill?: never
}

type StyleProps = SizedStyleProps | LinkStyleProps

type StyleKey = "kind" | "size" | "block" | "pill"

type AsButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | StyleKey> & {
  as?: "button"
  href?: never
  children: ReactNode
}

type AsAnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | StyleKey | "href"> & {
  as: "a"
  href: string
  children: ReactNode
}

type ButtonProps = (AsButtonProps | AsAnchorProps) & StyleProps

const sizeClass: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-fs-body-sm",
  md: "px-4 py-2 text-fs-body",
  lg: "px-6 py-3 text-fs-body",
}

const kindClass: Record<ButtonKind, string> = {
  primary: "bg-brand text-white border-0",
  secondary: "bg-surface text-ink border border-border-soft",
  danger: "bg-surface text-red border border-red",
  ghost: "bg-transparent text-brand-deep border-0",
  accent: "bg-brand-soft text-brand-deep border border-brand/50",
  link: "bg-transparent text-brand border-0 p-0 font-semibold rounded-none",
}

export const Button = (props: ButtonProps) => {
  const kind: ButtonKind = props.kind ?? "primary"
  const size = kind === "link" ? undefined : (props as SizedStyleProps).size
  const block = kind === "link" ? false : Boolean((props as SizedStyleProps).block)
  const pill = kind === "link" ? false : Boolean((props as SizedStyleProps).pill)
  const disabled = props.as === "a" ? false : Boolean(props.disabled)

  const sizedClass = kind === "link" ? null : sizeClass[size ?? "md"]
  // `link` keeps its own rounded-none; otherwise pill swaps the default 6px radius
  // for a fully rounded shape.
  const radiusClass = kind === "link" ? null : pill ? "rounded-pill" : "rounded-button"

  const className = cn(
    "inline-flex items-center gap-1.5 font-semibold font-sans cursor-pointer leading-none",
    radiusClass,
    sizedClass,
    kindClass[kind],
    block && "w-full justify-start text-left",
    disabled && "cursor-not-allowed opacity-55",
  )

  if (props.as === "a") {
    const {
      as: _as,
      kind: _kind,
      size: _size,
      block: _block,
      pill: _pill,
      children,
      ...anchorRest
    } = props
    void _as
    void _kind
    void _size
    void _block
    void _pill
    return (
      <a {...anchorRest} className={className}>
        {children}
      </a>
    )
  }

  const {
    as: _as,
    kind: _kind,
    size: _size,
    block: _block,
    pill: _pill,
    type = "button",
    disabled: disabledProp,
    children,
    ...buttonRest
  } = props
  void _as
  void _kind
  void _size
  void _block
  void _pill
  return (
    <button
      {...buttonRest}
      type={type}
      disabled={disabledProp || undefined}
      aria-disabled={disabledProp || undefined}
      className={className}
    >
      {children}
    </button>
  )
}
