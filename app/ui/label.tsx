import type { CSSProperties, ReactNode } from "react"

type LabelProps = {
  children: ReactNode
  color?: string
  size?: number
  as?: "span" | "div"
}

export const Label = ({ children, color, size, as = "span" }: LabelProps) => {
  const style: CSSProperties | undefined =
    color === undefined && size === undefined ? undefined : { color, fontSize: size }
  const className =
    "font-mono font-bold uppercase tracking-label text-ink-mid text-fs-label"

  return as === "div"
    ? <div className={className} style={style}>{children}</div>
    : <span className={className} style={style}>{children}</span>
}
