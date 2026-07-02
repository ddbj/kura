import type { ReactNode } from "react"

import { cn } from "./cn"
import { Label } from "./label"
import { Tag } from "./tag"

type ModalPreviewProps = {
  label: ReactNode
  children: ReactNode
  footnote?: ReactNode
}

export const ModalPreview = ({ label, children, footnote }: ModalPreviewProps) => (
  <aside className="flex-[0_0_44%] border-l border-border-soft bg-surface-subtle px-5 py-5 overflow-auto">
    <Label as="div">{label}</Label>
    <div className="mt-3">{children}</div>
    {footnote !== undefined && (
      <div className="mt-3 pt-3 border-t border-dashed border-border-soft text-fs-micro text-ink-mid leading-relaxed">
        {footnote}
      </div>
    )}
  </aside>
)

type PreviewCardProps = {
  source: "DDBJ" | "DBCLS"
  db: string
  title: ReactNode
  body: ReactNode
  active?: boolean
}

export const PreviewCard = ({ source, db, title, body, active = true }: PreviewCardProps) => (
  <div
    className={cn(
      "bg-surface border border-border-soft rounded-button px-3 py-2.5 mb-2",
      !active && "opacity-50",
    )}
  >
    <div className="flex items-center gap-1.5 mb-1">
      <Tag kind="source" name={source} />
      <span className="font-mono text-fs-micro font-bold text-ink-mid">{db}</span>
    </div>
    <div className="text-fs-body-sm font-bold text-ink mb-0.5">{title}</div>
    <div className="text-fs-label text-ink-mid leading-relaxed">{body}</div>
  </div>
)
