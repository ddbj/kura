import type { S3Client } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"

import { abortPendingUpload } from "./multipart"

const MiB = 1024 * 1024
const DEFAULT_PART_SIZE = 8 * MiB
const MAX_PARTS = 10_000

// lib-storage's done() settles as soon as the abort signal fires, without
// waiting for an in-flight CreateMultipartUpload; that request keeps running
// in the background and eventually sets upload.uploadId regardless. Poll for
// it (bounded by a normal request round trip) so a cancel issued during
// CreateMultipartUpload still discards the upload once its id is known.
const UPLOAD_ID_POLL_INTERVAL_MS = 200
const UPLOAD_ID_POLL_TIMEOUT_MS = 15_000
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// S3 multipart caps out at 10000 parts, so grow the part size just enough for
// files the default cannot cover.
export const computePartSize = (fileSize: number): number =>
  Math.max(DEFAULT_PART_SIZE, Math.ceil(fileSize / MAX_PARTS))

export type UploadProgress = { loaded: number; total: number }

export type RunningUpload = {
  done: Promise<void>
  // Explicit cancel: stops in-flight parts and discards the parts already on
  // the server; done rejects afterwards. Failures other than cancel keep the
  // parts so the upload can be resumed (app/lib/s3/resume.ts).
  abort: () => Promise<void>
  // The multipart upload id, once known. Single PUTs (small files) never get
  // one; they leave nothing behind to resume or discard.
  uploadId: () => string | undefined
}

export const startUpload = ({ s3, bucket, key, file, onProgress }: {
  s3: S3Client
  bucket: string
  key: string
  file: File
  onProgress: (progress: UploadProgress) => void
}): RunningUpload => {
  const partSize = computePartSize(file.size)
  // Matches lib-storage's own single-part-vs-multipart chunking decision, so
  // this is known upfront without reaching into its (privately typed)
  // isMultiPart field.
  const isMultipart = file.size > partSize
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: file,
      ...(file.type === "" ? {} : { ContentType: file.type }),
    },
    partSize,
    // Errors keep the completed parts on the server for resume.
    leavePartsOnError: true,
  })
  upload.on("httpUploadProgress", (progress) => {
    onProgress({ loaded: progress.loaded ?? 0, total: progress.total ?? file.size })
  })

  const done = upload.done().then(() => undefined)

  return {
    done,
    // With leavePartsOnError, upload.abort() only stops the transfer; the
    // server-side discard is on us. If CreateMultipartUpload was still
    // in-flight when cancelled, its id is not known yet, so wait for it
    // (see UPLOAD_ID_POLL_* above) before deciding there is nothing to discard.
    // Single-PUT uploads never get one, so skip the wait entirely for those.
    abort: async () => {
      await upload.abort()
      await done.catch(() => undefined)
      if (isMultipart) {
        const deadline = Date.now() + UPLOAD_ID_POLL_TIMEOUT_MS
        while (upload.uploadId === undefined && Date.now() < deadline) {
          await sleep(UPLOAD_ID_POLL_INTERVAL_MS)
        }
      }
      const uploadId = upload.uploadId
      if (uploadId !== undefined) {
        await abortPendingUpload(s3, bucket, key, uploadId)
      }
    },
    uploadId: () => upload.uploadId,
  }
}
