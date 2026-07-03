import {
  CreateMultipartUploadCommand,
  GetObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { describe, expect, it } from "vitest"

import { abortPendingUpload, listPendingUploads } from "~/lib/s3/multipart"
import { resumeUpload } from "~/lib/s3/resume"
import type { UploadProgress } from "~/lib/s3/upload"
import { computePartSize } from "~/lib/s3/upload"
import { ResumeMismatchError } from "~/lib/s3/verify"

import { assumeRole, s3ClientFor, setupUser, signToken } from "./_helpers"

const PART_SIZE = computePartSize(1)

// The full app-side resume flow (discover -> verify by MD5 -> upload the
// rest -> complete) against the real SeaweedFS: an interrupted upload with
// part 1 on the server, taken over from a fresh STS session.
describe("upload resume flow", () => {
  const interrupt = async () => {
    const { username, s3 } = await setupUser()
    const key = "dir/resume me.bin"
    const bytes = new Uint8Array(PART_SIZE + 1024 * 1024)
    for (let i = 0; i < bytes.length; i += 4096) bytes[i] = i % 251

    const created = await s3.send(
      new CreateMultipartUploadCommand({ Bucket: username, Key: key }),
    )
    await s3.send(new UploadPartCommand({
      Bucket: username,
      Key: key,
      UploadId: created.UploadId!,
      PartNumber: 1,
      Body: bytes.slice(0, PART_SIZE),
    }))

    return { username, key, bytes }
  }

  it("discovers the interrupted upload and finishes it byte-identically", async () => {
    const { username, key, bytes } = await interrupt()

    const fresh = s3ClientFor(await assumeRole(await signToken({ username })))
    const pending = await listPendingUploads(fresh, username, "dir/")
    expect(pending.map((p) => p.key)).toEqual([key])

    const progress: UploadProgress[] = []
    await resumeUpload({
      s3: fresh,
      bucket: username,
      key,
      uploadId: pending[0]!.uploadId,
      file: new File([bytes], "resume me.bin"),
      onProgress: (p) => progress.push(p),
    }).done
    expect(progress[0]!.loaded).toBe(PART_SIZE)

    const got = await fresh.send(new GetObjectCommand({ Bucket: username, Key: key }))
    const downloaded = Buffer.from(await got.Body!.transformToByteArray())
    expect(downloaded.equals(Buffer.from(bytes))).toBe(true)
    expect(await listPendingUploads(fresh, username, "")).toEqual([])
  })

  it("rejects a re-selected file whose content differs, keeping the upload", async () => {
    const { username, key, bytes } = await interrupt()
    const changed = new Uint8Array(bytes)
    changed[1] = changed[1]! ^ 0xff

    const fresh = s3ClientFor(await assumeRole(await signToken({ username })))
    const [pending] = await listPendingUploads(fresh, username, "")
    await expect(resumeUpload({
      s3: fresh,
      bucket: username,
      key,
      uploadId: pending!.uploadId,
      file: new File([changed], "resume me.bin"),
      onProgress: () => undefined,
    }).done).rejects.toBeInstanceOf(ResumeMismatchError)

    // Still resumable with the right file.
    expect(await listPendingUploads(fresh, username, "")).toHaveLength(1)
  })

  it("discards an interrupted upload on request", async () => {
    const { username, key } = await interrupt()

    const fresh = s3ClientFor(await assumeRole(await signToken({ username })))
    const [pending] = await listPendingUploads(fresh, username, "")
    await abortPendingUpload(fresh, username, key, pending!.uploadId)
    // Idempotent: a second discard (e.g. double click) is fine.
    await abortPendingUpload(fresh, username, key, pending!.uploadId)

    expect(await listPendingUploads(fresh, username, "")).toEqual([])
  })
})
