import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { describe, expect, it } from "vitest"

import { assumeRole, putText, s3ClientFor, setupUser, signToken } from "./_helpers"

describe("multipart upload", () => {
  it("uploads in parts and downloads the identical bytes", async () => {
    const { username, s3 } = await setupUser()
    const key = "dir/multi.bin"
    const part1 = Buffer.alloc(5 * 1024 * 1024, 1)
    const part2 = Buffer.alloc(1 * 1024 * 1024, 2)

    const created = await s3.send(
      new CreateMultipartUploadCommand({ Bucket: username, Key: key }),
    )
    const uploadId = created.UploadId!
    const parts = []
    for (const [index, body] of [part1, part2].entries()) {
      const res = await s3.send(
        new UploadPartCommand({
          Bucket: username,
          Key: key,
          UploadId: uploadId,
          PartNumber: index + 1,
          Body: body,
        }),
      )
      parts.push({ PartNumber: index + 1, ETag: res.ETag })
    }
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: username,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    )

    const got = await s3.send(new GetObjectCommand({ Bucket: username, Key: key }))
    const bytes = Buffer.from(await got.Body!.transformToByteArray())
    expect(bytes.length).toBe(part1.length + part2.length)
    expect(bytes.equals(Buffer.concat([part1, part2]))).toBe(true)
  })
})

describe("multipart upload resume", () => {
  it("continues an interrupted upload from a fresh STS session", async () => {
    const { username, s3 } = await setupUser()
    const key = "resume.bin"
    const part1 = Buffer.alloc(5 * 1024 * 1024, 3)
    const part2 = Buffer.alloc(1 * 1024 * 1024, 4)

    const created = await s3.send(
      new CreateMultipartUploadCommand({ Bucket: username, Key: key }),
    )
    const uploadId = created.UploadId!
    await s3.send(
      new UploadPartCommand({
        Bucket: username,
        Key: key,
        UploadId: uploadId,
        PartNumber: 1,
        Body: part1,
      }),
    )

    // A new session (fresh token and credentials) stands in for the client
    // coming back after an interruption.
    const fresh = s3ClientFor(await assumeRole(await signToken({ username })))
    const listed = await fresh.send(
      new ListPartsCommand({ Bucket: username, Key: key, UploadId: uploadId }),
    )
    expect(listed.Parts?.map((p) => p.PartNumber)).toEqual([1])

    const res = await fresh.send(
      new UploadPartCommand({
        Bucket: username,
        Key: key,
        UploadId: uploadId,
        PartNumber: 2,
        Body: part2,
      }),
    )
    await fresh.send(
      new CompleteMultipartUploadCommand({
        Bucket: username,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [
            { PartNumber: 1, ETag: listed.Parts![0]!.ETag },
            { PartNumber: 2, ETag: res.ETag },
          ],
        },
      }),
    )

    const got = await fresh.send(new GetObjectCommand({ Bucket: username, Key: key }))
    const bytes = Buffer.from(await got.Body!.transformToByteArray())
    expect(bytes.equals(Buffer.concat([part1, part2]))).toBe(true)
  })
})

describe("presigned URLs with temporary credentials", () => {
  it("serves a private object through a presigned GET", async () => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "presigned.txt", "presigned content")

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: username, Key: "presigned.txt" }),
      { expiresIn: 300 },
    )
    expect(url).toContain("X-Amz-Security-Token=")

    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("presigned content")
  })

  it("accepts an upload through a presigned PUT", async () => {
    const { username, s3 } = await setupUser()

    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: username, Key: "uploaded.txt" }),
      { expiresIn: 300 },
    )
    const put = await fetch(url, { method: "PUT", body: "via presign" })
    expect(put.status).toBe(200)

    const got = await s3.send(
      new GetObjectCommand({ Bucket: username, Key: "uploaded.txt" }),
    )
    expect(await got.Body!.transformToString()).toBe("via presign")
  })

  it("rejects the same request without the signature", async () => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "presigned.txt", "x")

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: username, Key: "presigned.txt" }),
      { expiresIn: 300 },
    )
    const bare = new URL(url)
    bare.search = ""

    const res = await fetch(bare)
    expect(res.status).toBe(403)
  })
})
