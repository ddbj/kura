import { delay, http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import { resumeUpload } from "~/lib/s3/resume"
import type { UploadProgress } from "~/lib/s3/upload"
import { ResumeMismatchError } from "~/lib/s3/verify"

import { TEST_S3_ENDPOINT as ENDPOINT, testS3 } from "../../_helpers/s3"
import { completeMultipartUploadXml, listPartsXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const MiB = 1024 * 1024
const xml = (body: string) =>
  new HttpResponse(body, { status: 200, headers: { "Content-Type": "application/xml" } })
// Pre-computed MD5 hex of 8 MiB of 0x07 (node:crypto is unavailable in the
// jsdom project).
const MD5_PART1 = "0060f6593824eacb6d4b9785b315167c"
const MD5_OTHER_FILE = "2e9ec317e197819358fbc43afca7d837"

// 16 MiB file = two 8 MiB parts; part 1 is already on the server.
const bytes = new Uint8Array(16 * MiB).fill(7)
const file = new File([bytes], "big.bin")
const KEY_URL = `${ENDPOINT}/kura-tester/docs/big.bin`

const listPartsHandler = (part1Etag: string) =>
  http.get(KEY_URL, () => xml(listPartsXml({
    bucket: "kura-tester",
    key: "docs/big.bin",
    uploadId: "up-1",
    parts: [{ partNumber: 1, size: 8 * MiB, etag: part1Etag }],
  })))

const resume = (onProgress: (p: UploadProgress) => void = () => undefined) =>
  resumeUpload({
    s3: testS3(),
    bucket: "kura-tester",
    key: "docs/big.bin",
    uploadId: "up-1",
    file,
    onProgress,
  })

describe("resumeUpload", () => {
  test("resumeUpload_partialUpload_sendsOnlyMissingPartsAndCompletes", async () => {
    const uploadedParts: string[] = []
    let completeBody = ""
    server.use(
      listPartsHandler(MD5_PART1),
      http.put(KEY_URL, ({ request }) => {
        uploadedParts.push(new URL(request.url).searchParams.get("partNumber") ?? "?")

        return new HttpResponse(null, { status: 200, headers: { ETag: "\"etag-2\"" } })
      }),
      http.post(KEY_URL, async ({ request }) => {
        completeBody = await request.text()

        return xml(completeMultipartUploadXml({
          bucket: "kura-tester", key: "docs/big.bin", etag: "final",
        }))
      }),
    )

    const progress: UploadProgress[] = []
    await resume((p) => progress.push(p)).done

    expect(uploadedParts).toEqual(["2"])
    // Complete carries every part in order: the pre-existing one and the new one.
    expect(completeBody.indexOf("<PartNumber>1</PartNumber>"))
      .toBeLessThan(completeBody.indexOf("<PartNumber>2</PartNumber>"))
    expect(completeBody).toContain("etag-2")
    // Progress starts from the already-uploaded bytes and grows monotonically.
    expect(progress[0]).toEqual({ loaded: 8 * MiB, total: 16 * MiB })
    expect(progress.at(-1)).toEqual({ loaded: 16 * MiB, total: 16 * MiB })
    const monotonic = progress.every((p, i) => i === 0 || p.loaded >= progress[i - 1]!.loaded)
    expect(monotonic).toBe(true)
  })

  test("resumeUpload_differingLocalFile_rejectsWithoutCompleting", async () => {
    let completed = false
    server.use(
      listPartsHandler(MD5_OTHER_FILE),
      http.put(KEY_URL, () =>
        new HttpResponse(null, { status: 200, headers: { ETag: "\"etag-2\"" } })),
      http.post(KEY_URL, () => {
        completed = true

        return xml(completeMultipartUploadXml({
          bucket: "kura-tester", key: "docs/big.bin", etag: "final",
        }))
      }),
    )

    await expect(resume().done).rejects.toBeInstanceOf(ResumeMismatchError)
    expect(completed).toBe(false)
  })

  test("resumeUpload_inconsistentPartLayout_rejects", async () => {
    server.use(http.get(KEY_URL, () => xml(listPartsXml({
      bucket: "kura-tester",
      key: "docs/big.bin",
      uploadId: "up-1",
      // 8 MiB layout says part 1 must be exactly 8 MiB.
      parts: [{ partNumber: 1, size: 5 * MiB, etag: "e1" }],
    }))))

    await expect(resume().done).rejects.toBeInstanceOf(ResumeMismatchError)
  })

  test("resumeUpload_abort_discardsTheUpload", async () => {
    let abortedOnServer = false
    server.use(
      listPartsHandler(MD5_PART1),
      http.put(KEY_URL, async () => {
        await delay(5_000)

        return new HttpResponse(null, { status: 200, headers: { ETag: "\"etag-2\"" } })
      }),
      http.delete(KEY_URL, () => {
        abortedOnServer = true

        return new HttpResponse(null, { status: 204 })
      }),
    )

    const running = resume()
    await running.abort()
    await expect(running.done).rejects.toThrow()
    expect(abortedOnServer).toBe(true)
  })
})
