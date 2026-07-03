import type { S3Client } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"

import { abortPendingUpload } from "./multipart"

const MiB = 1024 * 1024
const DEFAULT_PART_SIZE = 8 * MiB
const MAX_PARTS = 10_000

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
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: file,
      ...(file.type === "" ? {} : { ContentType: file.type }),
    },
    partSize: computePartSize(file.size),
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
    // server-side discard is on us. The uploadId is re-read after done
    // settles to close the race with a cancel before CreateMultipartUpload
    // finished.
    abort: async () => {
      await upload.abort()
      await done.catch(() => undefined)
      const uploadId = upload.uploadId
      if (uploadId !== undefined) {
        await abortPendingUpload(s3, bucket, key, uploadId)
      }
    },
    uploadId: () => upload.uploadId,
  }
}
