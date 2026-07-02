import type { S3Client } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"

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
  // Stops in-flight parts and aborts the multipart upload on S3 (no leftover
  // parts); done rejects afterwards.
  abort: () => Promise<void>
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
  })
  upload.on("httpUploadProgress", (progress) => {
    onProgress({ loaded: progress.loaded ?? 0, total: progress.total ?? file.size })
  })

  return {
    done: upload.done().then(() => undefined),
    abort: () => upload.abort(),
  }
}
