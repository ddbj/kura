import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { publicUrl } from "~/lib/s3/public-url"

// S3 key の segment: "/" を含まない非空文字列 (unicode / percent / 記号 / "." ".." 含む)。
const segment = fc.oneof(
  fc.string({ minLength: 1 }).filter((s) => !s.includes("/")),
  fc.constantFrom(".", "..", "%2F", "%2E", "a b", "日本語 ファイル?#", "100%.txt"),
)
const key = fc.array(segment, { minLength: 1, maxLength: 6 }).map((segs) => segs.join("/"))
const bucket = fc.constantFrom("kura-tester", "u01", "a-b.c")
const base = fc.constantFrom(
  "http://localhost:28080",
  "https://kura.ddbj.nig.ac.jp",
  "https://kura.ddbj.nig.ac.jp/",
)

describe("publicUrl properties", () => {
  test.prop([base, bucket, key])("publicUrl_pathSegments_decodeBackToKey", (b, user, k) => {
    const url = publicUrl(b, user, k)
    const origin = b.replace(/\/+$/, "")
    expect(url.startsWith(`${origin}/${user}/`)).toBe(true)

    const encodedSegments = url.slice(`${origin}/${user}/`.length).split("/")
    expect(encodedSegments.map(decodeURIComponent)).toEqual(k.split("/"))
  })

  test.prop([base, bucket, key])("publicUrl_pathPart_hasNoCharsBreakingUrlStructure", (b, user, k) => {
    const origin = b.replace(/\/+$/, "")
    expect(publicUrl(b, user, k).slice(origin.length)).not.toMatch(/[?#\s]/)
  })

  // "." / ".." という名前は WHATWG URL / nginx の dot-segment 正規化で潰される
  // (公開 URL で表現できない配信側の制約) ため、それ以外で正規化不変を検証する。
  test.prop([base, bucket, key])("publicUrl_nonDotKey_survivesUrlNormalization", (b, user, k) => {
    fc.pre(k.split("/").every((seg) => seg !== "." && seg !== ".."))
    const url = publicUrl(b, user, k)
    expect(new URL(url).href).toBe(url)
  })

  test.prop([bucket, key])("publicUrl_trailingSlashInBase_doesNotChangeResult", (user, k) => {
    expect(publicUrl("https://kura.ddbj.nig.ac.jp/", user, k))
      .toBe(publicUrl("https://kura.ddbj.nig.ac.jp", user, k))
  })
})
