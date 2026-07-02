import type { ReactNode } from "react"

import { cn } from "./cn"

type NewsDateProps = {
  children: ReactNode
  className?: string
}

// news / notification / docs 系の日付表示を統一するための primitive。
// font-mono + fs-meta + tracking-mono + ink-soft の 4 token を SSOT として持ち、
// 呼び出し側で formatDate(iso) 済みの文字列を children で渡す (i18n 依存は
// 呼び出し側で吸収し、 ui/ 層は lib/ 非依存を保つ)。
export const NewsDate = ({ children, className }: NewsDateProps) => (
  <span className={cn("font-mono text-fs-meta tracking-mono text-ink-soft", className)}>
    {children}
  </span>
)
