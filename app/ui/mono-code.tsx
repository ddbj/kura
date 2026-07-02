import type { ReactNode } from "react"

import { cn } from "./cn"

type MonoCodeProps = {
  children: ReactNode
  className?: string
}

// accession code / DSL preview / URL path など「等幅で表示したい inline メタ文字列」
// 用 primitive。 font-mono + tracking-mono を SSOT として持ち、 呼び出し側で
// font-size / color / overflow / whitespace 制御は className で上書きする。
export const MonoCode = ({ children, className }: MonoCodeProps) => (
  <span className={cn("font-mono tracking-mono", className)}>{children}</span>
)
