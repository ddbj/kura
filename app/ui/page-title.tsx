import type { CSSProperties, ReactNode } from "react"

import { cn } from "./cn"
import { Heading } from "./heading"

type PageTitlePad = "trimmed" | "none" | "sm" | "md"

type PageTitleProps = {
  title: ReactNode
  subtitle?: ReactNode
  eyebrow?: ReactNode
  meta?: ReactNode
  maxWidth?: number
  padTop?: PageTitlePad
  padBottom?: PageTitlePad
}

// breadcrumb 直下の page (h1 上に「ホーム › ...」 行がある) は padTop="trimmed"
// を指定すると breadcrumb と h1 の間に追加の余白を積まず、breadcrumb 高 (py-2 +
// 内容 ≈ pt-9 相当) だけで breadcrumb 無し page の既定 (pt-9 = 36px) と h1 の縦
// 位置が揃う。
const padTopClass: Record<PageTitlePad, string> = {
  trimmed: "pt-0",
  none: "pt-0",
  sm: "pt-6",
  md: "pt-9",
}

const padBottomClass: Record<PageTitlePad, string> = {
  trimmed: "pb-0",
  none: "pb-0",
  sm: "pb-3",
  md: "pb-6",
}

export const PageTitle = ({
  title,
  subtitle,
  eyebrow,
  meta,
  maxWidth,
  padTop = "md",
  padBottom = "md",
}: PageTitleProps) => {
  const inner: CSSProperties | undefined = maxWidth === undefined ? undefined : { maxWidth }

  return (
    <div className={cn("px-page-gutter", padTopClass[padTop], padBottomClass[padBottom])}>
      <div className="max-w-content-max mx-auto" style={inner}>
        {eyebrow !== undefined && (
          <div className="text-fs-label text-brand font-bold uppercase tracking-eyebrow font-mono mb-2">
            {eyebrow}
          </div>
        )}
        <div className="flex items-center justify-between gap-x-6 gap-y-2 flex-wrap">
          <Heading as="h1" size="h1" leading="none">
            {title}
          </Heading>
          {meta !== undefined && <div>{meta}</div>}
        </div>
        {subtitle !== undefined && (
          <p className="text-fs-body text-ink-mid leading-relaxed mt-3 max-w-content-narrow">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  )
}
