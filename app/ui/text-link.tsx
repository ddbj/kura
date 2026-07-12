import type { AnchorHTMLAttributes, ReactNode } from "react"
import { Link } from "react-router"

import { cn } from "./cn"

type Props = {
  to: string
  className?: string
  children: ReactNode
}

// Same-origin navigation only.
export const TextLink = ({ to, className, children }: Props) => (
  <Link to={to} className={cn("btn linky", className)}>{children}</Link>
)

type ExternalProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode
}

export const ExternalLink = ({ children, className, ...rest }: ExternalProps) => (
  <a rel="noopener noreferrer" target="_blank" className={cn("btn linky", className)} {...rest}>
    {children}
  </a>
)
