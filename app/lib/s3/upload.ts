import type { S3Client } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"

import { abortPendingUpload } from "./multipart"

const MiB = 1024 * 1024
const DEFAULT_PART_SIZE = 8 * MiB
const MAX_PARTS = 10_000

// Fallback bound for cases where lib-storage does not expose the create
// promise (older versions): a normal request round trip, but capped so we
// never linger 15s on a create that has already failed.
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

// Peek at the CreateMultipartUpload promise lib-storage stashes on the Upload
// instance. Awaiting it lets abort() exit as soon as the create resolves
// (uploadId known) or rejects (nothing to discard), instead of polling until
// timeout. Field is not part of the public API; the fallback covers versions
// that do not set it.
type UploadCreateInternals = { createMultiPartPromise?: Promise<unknown> }

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
    // server-side discard is on us. lib-storage's done() resolves as soon as
    // the abort signal fires, without waiting for an in-flight
    // CreateMultipartUpload — so ask the create promise directly whether it
    // has settled, and skip the discard when nothing was ever created.
    abort: async () => {
      await upload.abort()
      await done.catch(() => undefined)
      if (!isMultipart) return

      const createPromise = (upload as unknown as UploadCreateInternals).createMultiPartPromise
      if (createPromise !== undefined) {
        // Once the create resolves or rejects, we know exactly whether there
        // is an uploadId to abort — no need for a timed poll.
        await createPromise.catch(() => undefined)
      } else {
        // Very old lib-storage builds do not expose the create promise; race
        // upload.uploadId against a bounded deadline.
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
