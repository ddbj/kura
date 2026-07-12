import type { ButtonHTMLAttributes, ReactNode } from "react"

import { cn } from "./cn"

export type ButtonKind =
  | "default"
  | "pri"
  | "ghost"
  | "po"
  | "do"
  | "stop"
  | "ok"
  | "dangerbox"
  | "linky"

type ButtonSize = "md" | "sm" | "big"

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  kind?: ButtonKind
  size?: ButtonSize
  children: ReactNode
  type?: "button" | "submit" | "reset"
}

export const Button = ({
  kind = "default",
  size = "md",
  className,
  children,
  type = "button",
  ...rest
}: Props) => (
  <button
    type={type}
    className={cn("btn", { pri: kind === "pri", ghost: kind === "ghost", po: kind === "po", do: kind === "do", stop: kind === "stop", ok: kind === "ok", dangerbox: kind === "dangerbox", linky: kind === "linky" }, { sm: size === "sm", big: size === "big" }, className)}
    {...rest}
  >
    {children}
  </button>
)
