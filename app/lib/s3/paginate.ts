// Shared paginator for S3 list-style APIs. Stops when extractNextMarker
// returns undefined — IsTruncated alone cannot be trusted, because a
// truncated page whose Next* marker is missing would otherwise re-issue the
// same request forever (SeaweedFS has been observed in that shape). Callers
// normalize empty-string markers to undefined so this helper stays simple.
export const collectAllPages = async <TPage, TItem, TMarker>(
  fetchPage: (marker: TMarker | undefined) => Promise<TPage>,
  extractItems: (page: TPage) => TItem[],
  extractNextMarker: (page: TPage) => TMarker | undefined,
): Promise<TItem[]> => {
  const items: TItem[] = []
  let marker: TMarker | undefined
  for (;;) {
    const page = await fetchPage(marker)
    items.push(...extractItems(page))
    const next = extractNextMarker(page)
    if (next === undefined) return items
    marker = next
  }
}
