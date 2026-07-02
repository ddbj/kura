import type { ReactNode } from "react"

type PageProps = {
  children: ReactNode
}

export const Page = ({ children }: PageProps) => (
  <div className="min-h-full w-full bg-surface text-ink font-sans text-fs-body leading-relaxed">
    {children}
  </div>
)
