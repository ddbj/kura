import type { ReactNode } from "react"

// Row-name button — behaves like a link (navigates on click) but has the
// handoff .nm styling instead of a link's underline.
type Props = {
  to: string
  onNavigate: (to: string) => void
  className?: string
  title?: string
  children: ReactNode
}

export const FolderNavButton = ({ to, onNavigate, className, title, children }: Props) => (
  <button type="button" className={className} title={title} onClick={() => onNavigate(to)}>
    {children}
  </button>
)
