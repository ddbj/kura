import { Fragment, type ReactNode } from "react"

type MarkProps = {
  text: string
  terms: readonly string[]
}

const REGEX_META = /[.*+?^${}()|[\]\\]/g

const escapeRegExp = (s: string): string => s.replace(REGEX_META, "\\$&")

/** Wrap each occurrence of any term in <mark>. Case-insensitive, preserves the
 *  original casing in the rendered text. Empty term list passes the text through. */
export const Mark = ({ text, terms }: MarkProps): ReactNode => {
  const valid = terms.filter((t) => t.length > 0)
  if (valid.length === 0) return text

  const pattern = new RegExp(`(${valid.map(escapeRegExp).join("|")})`, "gi")
  const parts = text.split(pattern)

  return parts.map((part, i) => {
    if (part === "") return null
    if (i % 2 === 1) return <mark key={i}>{part}</mark>

    return <Fragment key={i}>{part}</Fragment>
  })
}
