// A browse prefix is "" (bucket root) or a "/"-terminated S3 key prefix
// ("docs/", "docs/sub/"). Segments never contain "/".

export const prefixToSegments = (prefix: string): string[] =>
  prefix === "" ? [] : prefix.slice(0, -1).split("/")

export const segmentsToPrefix = (segments: string[]): string =>
  segments.length === 0 ? "" : `${segments.join("/")}/`

export const parentPrefix = (prefix: string): string =>
  segmentsToPrefix(prefixToSegments(prefix).slice(0, -1))

export const entryName = (key: string): string => key.slice(key.lastIndexOf("/") + 1)

export const dirName = (dirPrefix: string): string => entryName(dirPrefix.slice(0, -1))

// "." / ".." segments survive percent-encoding as dot segments and would be
// rewritten by browser/proxy path normalization, so force the %2E form.
const encodeSegment = (segment: string): string => {
  if (segment === ".") return "%2E"
  if (segment === "..") return "%2E%2E"
  return encodeURIComponent(segment)
}

export const prefixToUrlPath = (prefix: string): string =>
  prefixToSegments(prefix).map(encodeSegment).join("/")

export const keyToUrlPath = (key: string): string =>
  key.split("/").map(encodeSegment).join("/")

// React Router splat params arrive percent-decoded; empty segments (from
// hand-typed "a//b" URLs) are dropped.
export const splatToPrefix = (splat: string): string =>
  segmentsToPrefix(splat.split("/").filter((segment) => segment !== ""))
