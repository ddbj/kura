import { S3Client } from "@aws-sdk/client-s3"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"

import { cleanupBucketUploads } from "../../../../scripts/lib/multipart.ts"
import { listMultipartUploadsXml, listPartsXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const ENDPOINT = "http://localhost:28333"
const BUCKET = "alice"
const KEY = "big.bin"
const UPLOAD_ID = "up-1"

const OLD = new Date("2020-01-01T00:00:00Z")
const RECENT = new Date("2020-01-10T00:00:00Z")
// 19 days after OLD, 10 after RECENT; maxAgeDays=7.
const NOW = new Date("2020-01-20T00:00:00Z")

const opsClient = (): S3Client =>
  new S3Client({
    endpoint: ENDPOINT,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "root", secretAccessKey: "root-secret" },
  })

// Consecutive ListParts responses on the same bucket/key/uploadId (snapshot,
// then recheck). Anything past the last page is returned again — no test
// probes further than that.
const partsSequence = (pages: readonly Date[][]) => {
  let call = 0
  return http.get(`${ENDPOINT}/${BUCKET}/${KEY}`, ({ request }) => {
    const url = new URL(request.url)
    expect(url.searchParams.get("uploadId")).toBe(UPLOAD_ID)
    const page = pages[Math.min(call, pages.length - 1)] as readonly Date[]
    call += 1
    return HttpResponse.xml(listPartsXml({
      bucket: BUCKET,
      key: KEY,
      uploadId: UPLOAD_ID,
      parts: page.map((lastModified, i) => ({
        partNumber: i + 1,
        size: 5 * 1024 * 1024,
        etag: "e",
        lastModified: lastModified.toISOString(),
      })),
    }))
  })
}

describe("cleanupBucketUploads recheck", () => {
  it("skips the abort when a new part appears between the snapshot and the recheck", async () => {
    const aborts: string[] = []
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, ({ request }) => {
        // ListMultipartUploads uses ?uploads, ListParts uses ?uploadId + ?key.
        const url = new URL(request.url)
        if (url.searchParams.has("uploads")) {
          return HttpResponse.xml(listMultipartUploadsXml({
            bucket: BUCKET,
            uploads: [{ key: KEY, uploadId: UPLOAD_ID }],
          }))
        }
        return new HttpResponse(null, { status: 400 })
      }),
      partsSequence([[OLD], [OLD, RECENT]]),
      http.delete(`${ENDPOINT}/${BUCKET}/${KEY}`, ({ request }) => {
        aborts.push(new URL(request.url).searchParams.get("uploadId") ?? "?")
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await expect(cleanupBucketUploads(opsClient(), BUCKET, 7, NOW)).resolves.toBe(0)
    expect(aborts).toEqual([])
  })

  it("aborts once the recheck confirms no new activity", async () => {
    const aborts: string[] = []
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.has("uploads")) {
          return HttpResponse.xml(listMultipartUploadsXml({
            bucket: BUCKET,
            uploads: [{ key: KEY, uploadId: UPLOAD_ID }],
          }))
        }
        return new HttpResponse(null, { status: 400 })
      }),
      partsSequence([[OLD], [OLD]]),
      http.delete(`${ENDPOINT}/${BUCKET}/${KEY}`, ({ request }) => {
        aborts.push(new URL(request.url).searchParams.get("uploadId") ?? "?")
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await expect(cleanupBucketUploads(opsClient(), BUCKET, 7, NOW)).resolves.toBe(1)
    expect(aborts).toEqual([UPLOAD_ID])
  })
})
