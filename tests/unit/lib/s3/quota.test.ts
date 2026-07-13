import { http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import { listBucketTotalBytes } from "~/lib/s3/quota"

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

describe("listBucketTotalBytes", () => {
  test("listBucketTotalBytes_singlePage_sumsSizes", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listXml({
          objects: [
            { key: "a.txt", sizeXml: "<Size>10</Size>" },
            { key: "b.txt", sizeXml: "<Size>25</Size>" },
          ],
        }))),
    )
    await expect(listBucketTotalBytes(testS3(), BUCKET)).resolves.toBe(35)
  })

  test("listBucketTotalBytes_emptyBucket_returnsZero", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listXml({ objects: [] }))),
    )
    await expect(listBucketTotalBytes(testS3(), BUCKET)).resolves.toBe(0)
  })

  test("listBucketTotalBytes_missingSizeElement_countsAsZero", async () => {
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
    await expect(listBucketTotalBytes(testS3(), BUCKET)).resolves.toBe(7)
  })

  test("listBucketTotalBytes_multiplePages_paginatesUntilExhausted", async () => {
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
    await expect(listBucketTotalBytes(testS3(), BUCKET)).resolves.toBe(350)
    expect(sentTokens).toEqual([null, "page-2", "page-3"])
  })

  test("listBucketTotalBytes_truncatedWithoutNextToken_stopsCleanlyOnFinalPage", async () => {
    // IsTruncated=false with no NextContinuationToken -> the loop stops
    // after one page; no infinite polling for a missing token.
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listXml({
          objects: [{ key: "only.txt", sizeXml: "<Size>42</Size>" }],
        }))),
    )
    await expect(listBucketTotalBytes(testS3(), BUCKET)).resolves.toBe(42)
  })

  test("listBucketTotalBytes_serverError_propagates", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        new HttpResponse(s3ErrorXml("AccessDenied", "denied"), {
          status: 403,
          headers: { "Content-Type": "application/xml" },
        })),
    )
    await expect(listBucketTotalBytes(testS3(), BUCKET)).rejects.toThrow()
  })

  test("listBucketTotalBytes_truncatedWithoutNextToken_stopsInsteadOfLooping", async () => {
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
    await expect(listBucketTotalBytes(testS3(), BUCKET)).resolves.toBe(17)
    expect(calls).toBe(1)
  })
})
