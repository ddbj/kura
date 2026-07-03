import { http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import { abortPendingUpload, listPendingUploads, listUploadedParts } from "~/lib/s3/multipart"

import { TEST_S3_ENDPOINT as ENDPOINT, testS3 } from "../../_helpers/s3"
import { listMultipartUploadsXml, listPartsXml, s3ErrorXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const xml = (body: string, status = 200) =>
  new HttpResponse(body, { status, headers: { "Content-Type": "application/xml" } })

describe("listPendingUploads", () => {
  test("listPendingUploads_truncatedResponse_followsAllPages", async () => {
    const markers: (string | null)[] = []
    server.use(http.get(`${ENDPOINT}/kura-tester`, ({ request }) => {
      const url = new URL(request.url)
      expect(url.searchParams.has("uploads")).toBe(true)
      expect(url.searchParams.get("prefix")).toBe("docs/")
      markers.push(url.searchParams.get("key-marker"))
      if (url.searchParams.get("key-marker") === null) {
        return xml(listMultipartUploadsXml({
          bucket: "kura-tester",
          uploads: [{ key: "docs/a.bin", uploadId: "id-a" }],
          nextKeyMarker: "docs/a.bin",
          nextUploadIdMarker: "id-a",
        }))
      }

      return xml(listMultipartUploadsXml({
        bucket: "kura-tester",
        uploads: [{ key: "docs/b.bin", uploadId: "id-b" }],
      }))
    }))

    const uploads = await listPendingUploads(testS3(), "kura-tester", "docs/")
    expect(uploads).toEqual([
      { key: "docs/a.bin", uploadId: "id-a" },
      { key: "docs/b.bin", uploadId: "id-b" },
    ])
    expect(markers).toEqual([null, "docs/a.bin"])
  })

  test("listPendingUploads_noUploads_returnsEmpty", async () => {
    server.use(http.get(`${ENDPOINT}/kura-tester`, () =>
      xml(listMultipartUploadsXml({ bucket: "kura-tester", uploads: [] }))))

    expect(await listPendingUploads(testS3(), "kura-tester", "")).toEqual([])
  })
})

describe("listUploadedParts", () => {
  test("listUploadedParts_truncatedResponse_collectsTypedParts", async () => {
    server.use(http.get(`${ENDPOINT}/kura-tester/docs/a.bin`, ({ request }) => {
      const url = new URL(request.url)
      expect(url.searchParams.get("uploadId")).toBe("id-a")
      if (url.searchParams.get("part-number-marker") === null) {
        return xml(listPartsXml({
          bucket: "kura-tester",
          key: "docs/a.bin",
          uploadId: "id-a",
          parts: [{ partNumber: 1, size: 8, etag: "e1", lastModified: "2026-07-01T00:00:00Z" }],
          nextPartNumberMarker: 1,
        }))
      }

      return xml(listPartsXml({
        bucket: "kura-tester",
        key: "docs/a.bin",
        uploadId: "id-a",
        parts: [{ partNumber: 2, size: 4, etag: "e2" }],
      }))
    }))

    const parts = await listUploadedParts(testS3(), "kura-tester", "docs/a.bin", "id-a")
    expect(parts).toEqual([
      { partNumber: 1, size: 8, etag: "\"e1\"", lastModified: new Date("2026-07-01T00:00:00Z") },
      { partNumber: 2, size: 4, etag: "\"e2\"" },
    ])
  })
})

describe("abortPendingUpload", () => {
  test("abortPendingUpload_alreadyGone_succeeds", async () => {
    server.use(http.delete(`${ENDPOINT}/kura-tester/docs/a.bin`, () =>
      xml(s3ErrorXml("NoSuchUpload", "not found"), 404)))

    await expect(
      abortPendingUpload(testS3(), "kura-tester", "docs/a.bin", "id-a"),
    ).resolves.toBeUndefined()
  })

  test("abortPendingUpload_denied_throws", async () => {
    server.use(http.delete(`${ENDPOINT}/kura-tester/docs/a.bin`, () =>
      xml(s3ErrorXml("AccessDenied", "no"), 403)))

    await expect(
      abortPendingUpload(testS3(), "kura-tester", "docs/a.bin", "id-a"),
    ).rejects.toThrow()
  })
})
