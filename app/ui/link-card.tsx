import type { ReactNode } from "react"
import { Link, type To } from "react-router"

import { ExternalLink } from "./external-link"

type LinkCardBase = {
  children: ReactNode
}

type LinkCardProps =
  | (LinkCardBase & { to: To; external?: false; href?: never; externalSrLabel?: never })
  // external 時は sr-only 「新しいタブで開く」ラベルが言語を持つため caller から
  // 翻訳済み文字列を受ける (ui primitive は i18n 非依存)。
  | (LinkCardBase & { href: string; external: true; externalSrLabel: string; to?: never })

const baseClass =
  "block bg-surface border border-border-soft rounded-card text-ink no-underline hover:shadow-card-hover transition-shadow"

export const LinkCard = (props: LinkCardProps) => {
  if (props.external) {
    return (
      <ExternalLink href={props.href} srLabel={props.externalSrLabel} className={baseClass}>
        {props.children}
      </ExternalLink>
    )
  }

  return (
    <Link to={props.to} className={baseClass}>
      {props.children}
    </Link>
  )
}
