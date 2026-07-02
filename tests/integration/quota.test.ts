import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import { describe, expect, it } from "vitest"

import { eventually, setupUser, weedShell } from "./_helpers"

describe("bucket quota", () => {
  it("rejects writes while over quota, keeps read/delete, and recovers", { timeout: 360_000 }, async () => {
    const { username, s3 } = await setupUser()
    weedShell(`s3.bucket.quota -name=${username} -op=set -sizeMB=1`)

    await s3.send(
      new PutObjectCommand({
        Bucket: username,
        Key: "fill.bin",
        Body: Buffer.alloc(2 * 1024 * 1024, 1),
      }),
    )

    // Enforcement recomputes sizes asynchronously; poll until the write flips
    // to rejected.
    const overQuotaStatus = await eventually(async () => {
      weedShell("s3.bucket.quota.enforce -apply")
      const status = await s3
        .send(new PutObjectCommand({ Bucket: username, Key: "probe.bin", Body: "x" }))
        .then(
          () => undefined,
          (err: { $metadata?: { httpStatusCode?: number } }) =>
            err.$metadata?.httpStatusCode,
        )
      if (status === undefined) {
        throw new Error("write not rejected yet")
      }

      return status
    })
    // The filer rejects read-only writes with 507, which the S3 layer
    // surfaces as a generic 500 InternalError.
    expect(overQuotaStatus).toBe(500)

    // Reads and deletes must keep working while read-only.
    const got = await s3.send(new GetObjectCommand({ Bucket: username, Key: "fill.bin" }))
    expect((await got.Body!.transformToByteArray()).length).toBe(2 * 1024 * 1024)
    await s3.send(new DeleteObjectCommand({ Bucket: username, Key: "fill.bin" }))

    // After deletion the bucket must become writable again. The logical size
    // only drops after the deleted needles are vacuumed, so compact this
    // bucket's collection while polling.
    await eventually(
      async () => {
        weedShell(`volume.vacuum -garbageThreshold=0.0001 -collection=${username}`)
        weedShell("s3.bucket.quota.enforce -apply")
        await s3.send(
          new PutObjectCommand({ Bucket: username, Key: "recovered.txt", Body: "ok" }),
        )
      },
      180_000,
      5_000,
    )
  })
})
