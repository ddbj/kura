import { delay, http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import type { UploadProgress } from "~/lib/s3/upload"
import { startUpload } from "~/lib/s3/upload"

import { TEST_S3_ENDPOINT as ENDPOINT,testS3 } from "../../_helpers/s3"
import { server } from "../../mocks/server"

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
    server.use(http.put(`${ENDPOINT}/kura-tester/docs/slow.txt`, async () => {
      await delay(5_000)
      return new HttpResponse(null, { status: 200, headers: { ETag: "\"etag\"" } })
    }))

    const upload = startUpload({
      s3: testS3(),
      bucket: "kura-tester",
      key: "docs/slow.txt",
      file: new File(["x"], "slow.txt", { type: "text/plain" }),
      onProgress: () => undefined,
    })
    await upload.abort()
    await expect(upload.done).rejects.toThrow()
  })
})
