import { delay, http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import type { UploadProgress } from "~/lib/s3/upload"
import { startUpload } from "~/lib/s3/upload"

import { TEST_S3_ENDPOINT as ENDPOINT,testS3 } from "../../_helpers/s3"
import { completeMultipartUploadXml, initiateMultipartUploadXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const MiB = 1024 * 1024
const xml = (body: string) =>
  new HttpResponse(body, { status: 200, headers: { "Content-Type": "application/xml" } })

// Big enough for lib-storage to take the multipart path (two 8 MiB parts).
const multipartFile = () => new File([new Uint8Array(16 * MiB)], "big.bin")

// Create (POST ?uploads) and Complete (POST ?uploadId) share the URL.
const multipartCreateHandler = (url: string, uploadId: string) =>
  http.post(url, ({ request }) => {
    const params = new URL(request.url).searchParams
    if (params.has("uploads")) {
      return xml(initiateMultipartUploadXml({ bucket: "kura-tester", key: "docs/big.bin", uploadId }))
    }

    return xml(completeMultipartUploadXml({ bucket: "kura-tester", key: "docs/big.bin", etag: "final" }))
  })

describe("startUpload", () => {
  test("startUpload_smallFile_putsObjectAndReportsProgress", async () => {
    const seen: { contentType: string | null; body: string }[] = []
    server.use(http.put(`${ENDPOINT}/kura-tester/docs/hello.txt`, async ({ request }) => {
      seen.push({ contentType: request.headers.get("content-type"), body: await request.text() })
      return new HttpResponse(null, { status: 200, headers: { ETag: "\"etag\"" } })
    }))

    const progress: UploadProgress[] = []
    const upload = startUpload({
      s3: testS3(),
      bucket: "kura-tester",
      key: "docs/hello.txt",
      file: new File(["hello"], "hello.txt", { type: "text/plain" }),
      onProgress: (p) => progress.push(p),
    })
    await upload.done

    expect(seen).toHaveLength(1)
    expect(seen[0]!.contentType).toContain("text/plain")
    expect(seen[0]!.body).toBe("hello")
    expect(progress.at(-1)).toEqual({ loaded: 5, total: 5 })
  })

  test("startUpload_serverError_rejectsDone", async () => {
    server.use(http.put(`${ENDPOINT}/kura-tester/docs/fail.txt`, () =>
      new HttpResponse(null, { status: 500 })))

    const upload = startUpload({
      s3: testS3(),
      bucket: "kura-tester",
      key: "docs/fail.txt",
      file: new File(["x"], "fail.txt", { type: "text/plain" }),
      onProgress: () => undefined,
    })
    await expect(upload.done).rejects.toThrow()
  })

  test("startUpload_abort_rejectsDone", async () => {
    const discards: string[] = []
    server.use(
      http.put(`${ENDPOINT}/kura-tester/docs/slow.txt`, async () => {
        await delay(5_000)
        return new HttpResponse(null, { status: 200, headers: { ETag: "\"etag\"" } })
      }),
      http.delete(`${ENDPOINT}/kura-tester/docs/slow.txt`, () => {
        discards.push("abort")
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const upload = startUpload({
      s3: testS3(),
      bucket: "kura-tester",
      key: "docs/slow.txt",
      file: new File(["x"], "slow.txt", { type: "text/plain" }),
      onProgress: () => undefined,
    })
    await upload.abort()
    await expect(upload.done).rejects.toThrow()
    // A single PUT never created a multipart upload, so nothing to discard.
    expect(upload.uploadId()).toBeUndefined()
    expect(discards).toEqual([])
  })

  test("startUpload_multipartCancel_discardsServerParts", async () => {
    const url = `${ENDPOINT}/kura-tester/docs/big.bin`
    const discards: string[] = []
    server.use(
      multipartCreateHandler(url, "up-cancel"),
      http.put(url, async () => {
        await delay(5_000)
        return new HttpResponse(null, { status: 200, headers: { ETag: "\"e\"" } })
      }),
      http.delete(url, ({ request }) => {
        discards.push(new URL(request.url).searchParams.get("uploadId") ?? "?")
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const upload = startUpload({
      s3: testS3(),
      bucket: "kura-tester",
      key: "docs/big.bin",
      file: multipartFile(),
      onProgress: () => undefined,
    })
    // Let CreateMultipartUpload finish so the cancel has an uploadId to discard.
    await expect.poll(() => upload.uploadId()).toBe("up-cancel")
    await upload.abort()
    await expect(upload.done).rejects.toThrow()
    expect(discards).toEqual(["up-cancel"])
  })

  test("startUpload_multipartError_keepsServerPartsForResume", async () => {
    const url = `${ENDPOINT}/kura-tester/docs/big.bin`
    const discards: string[] = []
    server.use(
      multipartCreateHandler(url, "up-err"),
      http.put(url, () => new HttpResponse(null, { status: 500 })),
      http.delete(url, () => {
        discards.push("abort")
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const upload = startUpload({
      s3: testS3(),
      bucket: "kura-tester",
      key: "docs/big.bin",
      file: multipartFile(),
      onProgress: () => undefined,
    })
    await expect(upload.done).rejects.toThrow()
    // leavePartsOnError: the failure leaves the upload resumable.
    expect(discards).toEqual([])
    expect(upload.uploadId()).toBe("up-err")
  })
})
