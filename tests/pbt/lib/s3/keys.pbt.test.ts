import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { entryName, keyParent, prefixToSegments, prefixToUrlPath, segmentsToPrefix, splatToPrefix } from "~/lib/s3/keys"

// S3 key の segment: "/" を含まない非空文字列 (unicode / percent / 記号 / "." ".." 含む)。
const segment = fc.oneof(
  fc.string({ minLength: 1 }).filter((s) => !s.includes("/")),
  fc.constantFrom(".", "..", "%2F", "%2E", "a b", "日本語 ファイル?#", "100%.txt"),
)
const segments = fc.array(segment, { maxLength: 6 })

// React Router の splat param は percent-decode 済みで渡ってくる。
const routerDecodedSplat = (urlPath: string): string =>
  urlPath.split("/").map(decodeURIComponent).join("/")

describe("prefix <-> segments", () => {
  test.prop([segments])("segmentsToPrefix_thenSegments_roundTrips", (segs) => {
    expect(prefixToSegments(segmentsToPrefix(segs))).toEqual(segs)
  })

  test.prop([segments])("segmentsToPrefix_isEmptyOrSlashTerminated", (segs) => {
    const prefix = segmentsToPrefix(segs)
    expect(prefix === "" || prefix.endsWith("/")).toBe(true)
  })

  // keyParent と entryName は 1 つの key をちょうど 2 つに割る。
  test.prop([segments, segment])("keyParent_andEntryName_partitionTheKey", (segs, last) => {
    const key = `${segmentsToPrefix(segs)}${last}`
    expect(keyParent(key)).toBe(segmentsToPrefix(segs))
    expect(entryName(key)).toBe(last)
    expect(`${keyParent(key)}${entryName(key)}`).toBe(key)
  })
})

describe("prefix <-> URL path", () => {
  test.prop([segments])("prefixToUrlPath_thenRouterDecode_roundTrips", (segs) => {
    const prefix = segmentsToPrefix(segs)
    expect(splatToPrefix(routerDecodedSplat(prefixToUrlPath(prefix)))).toBe(prefix)
  })

  test("prefixToUrlPath_thenRouterDecode_roundTripsThroughInternalEmptySegment", () => {
    // A key with a "//" (e.g. "a//b/file") carries an empty segment between
    // two non-empty ones; the round trip must not collapse it away.
    const prefix = "a//b/"
    expect(splatToPrefix(routerDecodedSplat(prefixToUrlPath(prefix)))).toBe(prefix)
  })

  test.prop([segments])("prefixToUrlPath_hasNoRawDotSegments", (segs) => {
    const urlSegments = prefixToUrlPath(segmentsToPrefix(segs)).split("/")
    expect(urlSegments).not.toContain(".")
    expect(urlSegments).not.toContain("..")
  })

  test.prop([segments])("prefixToUrlPath_hasNoCharsBreakingUrlStructure", (segs) => {
    const urlPath = prefixToUrlPath(segmentsToPrefix(segs))
    expect(urlPath).not.toMatch(/[?#\s]/)
  })
})
