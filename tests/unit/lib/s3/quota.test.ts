import { http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import { foldBucketStats, listBucketStats } from "~/lib/s3/quota"

import { TEST_S3_ENDPOINT as ENDPOINT, testS3 } from "../../_helpers/s3"
import { s3ErrorXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const BUCKET = "kura-tester"

const listXml = ({
  objects,
  nextToken,
}: {
  objects: readonly { key: string; sizeXml: string }[]
  nextToken?: string
}): string => `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${BUCKET}</Name>
  <KeyCount>${objects.length}</KeyCount>
  <IsTruncated>${nextToken === undefined ? "false" : "true"}</IsTruncated>
  ${nextToken === undefined ? "" : `<NextContinuationToken>${nextToken}</NextContinuationToken>`}
  ${objects.map((o) => `<Contents><Key>${o.key}</Key>${o.sizeXml}<LastModified>2026-07-01T10:00:00.000Z</LastModified><ETag>&quot;e&quot;</ETag><StorageClass>STANDARD</StorageClass></Contents>`).join("\n  ")}
</ListBucketResult>`

describe("listBucketStats", () => {
  test("listBucketStats_singlePage_sumsSizes", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listXml({
          objects: [
            { key: "a.txt", sizeXml: "<Size>10</Size>" },
            { key: "b.txt", sizeXml: "<Size>25</Size>" },
          ],
        }))),
    )
    await expect(listBucketStats(testS3(), BUCKET)).resolves.toMatchObject({ totalBytes: 35 })
  })

  test("listBucketStats_emptyBucket_returnsZero", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listXml({ objects: [] }))),
    )
    await expect(listBucketStats(testS3(), BUCKET)).resolves.toMatchObject({ totalBytes: 0 })
  })

  test("listBucketStats_missingSizeElement_countsAsZero", async () => {
    // A <Contents> without a <Size> tag (spec quirk in some backends) must
    // not tank the whole tally to NaN.
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listXml({
          objects: [
            { key: "a.txt", sizeXml: "" },
            { key: "b.txt", sizeXml: "<Size>7</Size>" },
          ],
        }))),
    )
    await expect(listBucketStats(testS3(), BUCKET)).resolves.toMatchObject({ totalBytes: 7 })
  })

  test("listBucketStats_multiplePages_paginatesUntilExhausted", async () => {
    const sentTokens: (string | null)[] = []
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, ({ request }) => {
        const token = new URL(request.url).searchParams.get("continuation-token")
        sentTokens.push(token)
        if (token === null) {
          return HttpResponse.xml(listXml({
            objects: [{ key: "a.txt", sizeXml: "<Size>100</Size>" }],
            nextToken: "page-2",
          }))
        }
        if (token === "page-2") {
          return HttpResponse.xml(listXml({
            objects: [{ key: "b.txt", sizeXml: "<Size>200</Size>" }],
            nextToken: "page-3",
          }))
        }
        return HttpResponse.xml(listXml({
          objects: [{ key: "c.txt", sizeXml: "<Size>50</Size>" }],
        }))
      }),
    )
    await expect(listBucketStats(testS3(), BUCKET)).resolves.toMatchObject({ totalBytes: 350 })
    expect(sentTokens).toEqual([null, "page-2", "page-3"])
  })

  test("listBucketStats_truncatedWithoutNextToken_stopsCleanlyOnFinalPage", async () => {
    // IsTruncated=false with no NextContinuationToken -> the loop stops
    // after one page; no infinite polling for a missing token.
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listXml({
          objects: [{ key: "only.txt", sizeXml: "<Size>42</Size>" }],
        }))),
    )
    await expect(listBucketStats(testS3(), BUCKET)).resolves.toMatchObject({ totalBytes: 42 })
  })

  test("listBucketStats_serverError_propagates", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        new HttpResponse(s3ErrorXml("AccessDenied", "denied"), {
          status: 403,
          headers: { "Content-Type": "application/xml" },
        })),
    )
    await expect(listBucketStats(testS3(), BUCKET)).rejects.toThrow()
  })

  test("listBucketStats_truncatedWithoutNextToken_stopsInsteadOfLooping", async () => {
    // A server that returns IsTruncated=true with no NextContinuationToken
    // used to trap the naive loop into resending the same request forever.
    // Treat "no next marker" as end-of-list and count only what was returned.
    let calls = 0
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () => {
        calls += 1
        return new HttpResponse(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${BUCKET}</Name>
  <KeyCount>1</KeyCount>
  <IsTruncated>true</IsTruncated>
  <Contents><Key>a.txt</Key><Size>17</Size><LastModified>2026-07-01T10:00:00.000Z</LastModified><ETag>&quot;e&quot;</ETag><StorageClass>STANDARD</StorageClass></Contents>
</ListBucketResult>`, { headers: { "Content-Type": "application/xml" } })
      }),
    )
    await expect(listBucketStats(testS3(), BUCKET)).resolves.toMatchObject({ totalBytes: 17 })
    expect(calls).toBe(1)
  })
})

// フォルダ行のサイズ / 更新日は、使用量の走査結果を畳んで作る。中間 prefix を
// 取りこぼすと、深い階層のフォルダだけ値が出ないという形で壊れる。
describe("foldBucketStats", () => {
  const at = (iso: string): number => new Date(iso).getTime()

  test("foldBucketStats_nestedKeys_accumulateIntoEveryAncestor", () => {
    const stats = foldBucketStats([
      { key: "a/b/deep.bin", size: 100, lastModifiedMs: at("2026-03-01T00:00:00Z") },
      { key: "a/shallow.txt", size: 20, lastModifiedMs: at("2026-05-01T00:00:00Z") },
      { key: "root.txt", size: 3, lastModifiedMs: at("2026-01-01T00:00:00Z") },
    ])

    expect(stats.totalBytes).toBe(123)
    expect(stats.folders.get("a/")).toEqual({ bytes: 120, lastModifiedMs: at("2026-05-01T00:00:00Z") })
    expect(stats.folders.get("a/b/")).toEqual({ bytes: 100, lastModifiedMs: at("2026-03-01T00:00:00Z") })
    // ルート直下のファイルはどのフォルダにも属さない
    expect(stats.folders.has("root.txt")).toBe(false)
  })

  test("foldBucketStats_similarlyNamedSiblings_doNotBleedIntoEachOther", () => {
    const stats = foldBucketStats([
      { key: "docs/a.txt", size: 10, lastModifiedMs: at("2026-01-01T00:00:00Z") },
      { key: "docs-2/b.txt", size: 40, lastModifiedMs: at("2026-01-02T00:00:00Z") },
    ])

    expect(stats.folders.get("docs/")?.bytes).toBe(10)
    expect(stats.folders.get("docs-2/")?.bytes).toBe(40)
  })

  test("foldBucketStats_folderMarkerOnly_isStillListedWithZeroBytes", () => {
    const stats = foldBucketStats([
      { key: "empty/.keep", size: 0, lastModifiedMs: at("2026-04-01T09:00:00Z") },
    ])

    expect(stats.folders.get("empty/")).toEqual({ bytes: 0, lastModifiedMs: at("2026-04-01T09:00:00Z") })
  })

  test("foldBucketStats_noObjects_isEmpty", () => {
    const stats = foldBucketStats([])

    expect(stats.totalBytes).toBe(0)
    expect(stats.folders.size).toBe(0)
  })
})
