import { createHash } from "node:crypto"

import type { S3Client } from "@aws-sdk/client-s3"
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
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

// The resume UI discovers interrupted uploads through ListMultipartUploads,
// so the exact shape SeaweedFS returns is pinned here.
describe("multipart upload inventory", () => {
  const begin = (s3: S3Client, bucket: string, key: string) =>
    s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }))
      .then((res) => res.UploadId!)

  it("lists in-flight uploads filtered by prefix, without Initiated", async () => {
    const { username, s3 } = await setupUser()
    await begin(s3, username, "a/one.bin")
    await begin(s3, username, "a/two.bin")
    await begin(s3, username, "b/three.bin")

    const all = await s3.send(new ListMultipartUploadsCommand({ Bucket: username }))
    expect(all.Uploads?.map((u) => u.Key).sort()).toEqual([
      "a/one.bin", "a/two.bin", "b/three.bin",
    ])
    for (const upload of all.Uploads!) {
      expect(upload.UploadId).toBeTruthy()
      // SeaweedFS does not report when an upload started, so the UI cannot
      // rely on Initiated (it derives recency from part LastModified instead).
      expect(upload.Initiated).toBeUndefined()
    }

    const scoped = await s3.send(
      new ListMultipartUploadsCommand({ Bucket: username, Prefix: "a/" }),
    )
    expect(scoped.Uploads?.map((u) => u.Key).sort()).toEqual(["a/one.bin", "a/two.bin"])
  })

  it("keeps concurrent in-flight uploads for the same key apart", async () => {
    const { username, s3 } = await setupUser()
    const key = "same.bin"
    const first = await begin(s3, username, key)
    const second = await begin(s3, username, key)
    expect(first).not.toBe(second)

    const listed = await s3.send(
      new ListMultipartUploadsCommand({ Bucket: username, Prefix: key }),
    )
    expect(listed.Uploads?.map((u) => u.UploadId).sort()).toEqual([first, second].sort())
  })

  it("returns part ETags equal to the MD5 of the part bytes", async () => {
    const { username, s3 } = await setupUser()
    const key = "etag.bin"
    const body = Buffer.alloc(5 * 1024 * 1024, 7)
    const md5 = createHash("md5").update(body).digest("hex")

    const uploadId = await begin(s3, username, key)
    const put = await s3.send(
      new UploadPartCommand({
        Bucket: username, Key: key, UploadId: uploadId, PartNumber: 1, Body: body,
      }),
    )
    expect(put.ETag).toBe(`"${md5}"`)

    const listed = await s3.send(
      new ListPartsCommand({ Bucket: username, Key: key, UploadId: uploadId }),
    )
    expect(listed.Parts?.map((p) => p.ETag)).toEqual([`"${md5}"`])
    expect(listed.Parts?.[0]?.LastModified).toBeInstanceOf(Date)
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
