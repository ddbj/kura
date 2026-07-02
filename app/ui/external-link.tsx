import type { AnchorHTMLAttributes, ReactNode } from "react"

// primitive は i18n 非依存。 sr-only 「新しいタブで開く」の翻訳済み文字列は caller
// (feature 側) が渡す。 target / rel を prop から受け取れないようにして、 全ての
// 外部リンクで target="_blank" + rel="noopener noreferrer" を強制する。
type ExternalLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "target" | "rel" | "href" | "children"
> & {
  href: string
  children: ReactNode
  srLabel: string
}

export const ExternalLink = ({ href, children, srLabel, ...rest }: ExternalLinkProps) => (
  <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
    {children}
    <span className="sr-only">{srLabel}</span>
  </a>
)
