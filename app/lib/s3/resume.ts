import type { S3Client } from "@aws-sdk/client-s3"
import { CompleteMultipartUploadCommand, UploadPartCommand } from "@aws-sdk/client-s3"

import type { UploadedPart } from "./multipart"
import { abortPendingUpload, listUploadedParts } from "./multipart"
import type { RunningUpload, UploadProgress } from "./upload"
import { computePartSize } from "./upload"
import { ResumeMismatchError, verifyCompletedParts } from "./verify"

// Matches the lib-storage default used for fresh uploads.
const CONCURRENCY = 4

export type PartRange = {
  partNumber: number
  start: number
  end: number
}

export type ResumePlan = {
  partSize: number
  totalParts: number
  completedBytes: number
  completed: UploadedPart[]
  remaining: PartRange[]
}

export type PlanResumeResult =
  | { ok: true; plan: ResumePlan }
  | { ok: false; reason: string }

// Reconstructs the part layout of an interrupted upload for a re-selected
// file. computePartSize is deterministic in the file size, so the original
// layout can be re-derived; any completed part that does not fit it means
// the file is not the one the upload started from.
export const planResume = ({ fileSize, parts }: {
  fileSize: number
  parts: UploadedPart[]
}): PlanResumeResult => {
  if (fileSize <= 0) {
    return { ok: false, reason: "empty file" }
  }
  const partSize = computePartSize(fileSize)
  const totalParts = Math.ceil(fileSize / partSize)
  const lastPartSize = fileSize - partSize * (totalParts - 1)

  const seen = new Set<number>()
  for (const part of parts) {
    if (part.partNumber < 1 || part.partNumber > totalParts) {
      return { ok: false, reason: `part ${part.partNumber} outside the file` }
    }
    if (seen.has(part.partNumber)) {
      return { ok: false, reason: `part ${part.partNumber} listed twice` }
    }
    seen.add(part.partNumber)
    const expected = part.partNumber === totalParts ? lastPartSize : partSize
    if (part.size !== expected) {
      return { ok: false, reason: `part ${part.partNumber} size differs` }
    }
  }

  const remaining: PartRange[] = []
  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    if (!seen.has(partNumber)) {
      const start = (partNumber - 1) * partSize
      remaining.push({ partNumber, start, end: Math.min(start + partSize, fileSize) })
    }
  }

  return {
    ok: true,
    plan: {
      partSize,
      totalParts,
      completedBytes: parts.reduce((sum, part) => sum + part.size, 0),
      completed: parts,
      remaining,
    },
  }
}

// Continues an interrupted multipart upload: uploads the missing parts while
// verifying the completed ones against the local file, then completes with
// the combined part list. On failure the parts stay on the server (still
// resumable); only an explicit abort() discards them.
export const resumeUpload = ({ s3, bucket, key, uploadId, file, onProgress }: {
  s3: S3Client
  bucket: string
  key: string
  uploadId: string
  file: File
  onProgress: (progress: UploadProgress) => void
}): RunningUpload => {
  const controller = new AbortController()

  const run = async (): Promise<void> => {
    const parts = await listUploadedParts(s3, bucket, key, uploadId)
    const planned = planResume({ fileSize: file.size, parts })
    if (!planned.ok) {
      throw new ResumeMismatchError(planned.reason)
    }
    const { plan } = planned
    let loaded = plan.completedBytes
    onProgress({ loaded, total: file.size })

    const uploaded = new Map<number, string>()
    const queue = [...plan.remaining]
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, queue.length) },
      async (): Promise<void> => {
        for (let range = queue.shift(); range !== undefined; range = queue.shift()) {
          // Bytes, not a Blob: the Node request handler (integration tests,
          // CLI use) rejects Blob bodies. Buffered per part, same order of
          // memory as lib-storage's queue.
          const body = new Uint8Array(await file.slice(range.start, range.end).arrayBuffer())
          controller.signal.throwIfAborted()
          const res = await s3.send(new UploadPartCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: range.partNumber,
            Body: body,
            ContentLength: range.end - range.start,
          }), { abortSignal: controller.signal })
          if (res.ETag === undefined) {
            throw new Error(`no ETag for part ${range.partNumber}`)
          }
          uploaded.set(range.partNumber, res.ETag)
          loaded += range.end - range.start
          onProgress({ loaded, total: file.size })
        }
      },
    )
    await Promise.all([
      verifyCompletedParts({
        file,
        parts: plan.completed,
        partSize: plan.partSize,
        signal: controller.signal,
      }),
      ...workers,
    ])

    const allParts = [
      ...plan.completed.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
      ...[...uploaded].map(([partNumber, etag]) => ({ PartNumber: partNumber, ETag: etag })),
    ].sort((a, b) => a.PartNumber - b.PartNumber)
    await s3.send(new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: allParts },
    }), { abortSignal: controller.signal })
  }

  const done = run().catch((err: unknown) => {
    // Stop sibling transfers; server-side parts are kept for the next try.
    controller.abort()
    throw err
  })

  return {
    done,
    abort: async () => {
      controller.abort()
      await done.catch(() => undefined)
      await abortPendingUpload(s3, bucket, key, uploadId)
    },
    uploadId: () => uploadId,
  }
}
