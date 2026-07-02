import { Fragment } from "react"

import { useT } from "~/lib/i18n"
import { prefixToSegments, prefixToUrlPath, segmentsToPrefix } from "~/lib/s3"
import { TextLink } from "~/ui"

export const PrefixBreadcrumb = ({ prefix }: { prefix: string }) => {
  const t = useT()
  const segments = prefixToSegments(prefix)
  return (
    <nav aria-label={t("browse.breadcrumbLabel")}>
      <ol className="flex flex-wrap items-center gap-1 text-fs-body-sm">
        <li>
          {segments.length === 0
            ? <span aria-current="page" className="text-ink">{t("browse.root")}</span>
            : <TextLink to="/">{t("browse.root")}</TextLink>}
        </li>
        {segments.map((segment, i) => {
          const isLast = i === segments.length - 1
          return (
            <Fragment key={segmentsToPrefix(segments.slice(0, i + 1))}>
              <li aria-hidden className="text-ink-softer">/</li>
              <li>
                {isLast
                  ? <span aria-current="page" className="text-ink">{segment}</span>
                  : <TextLink to={`/_browse/${prefixToUrlPath(segmentsToPrefix(segments.slice(0, i + 1)))}`}>{segment}</TextLink>}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
