import type { MultipartUpload, S3Client } from "@aws-sdk/client-s3"
import {
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  paginateListParts,
} from "@aws-sdk/client-s3"

import { isOlderThanDays } from "./time.ts"

// The SDK ships no paginator for ListMultipartUploads.
const listAllUploads = async (s3: S3Client, bucket: string): Promise<MultipartUpload[]> => {
  const uploads: MultipartUpload[] = []
  let keyMarker: string | undefined
  let uploadIdMarker: string | undefined
  for (;;) {
    const page = await s3.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
      }),
    )
    uploads.push(...(page.Uploads ?? []))
    if (page.IsTruncated !== true) {
      return uploads
    }
    keyMarker = page.NextKeyMarker
    uploadIdMarker = page.NextUploadIdMarker
  }
}

// Aborts multipart uploads whose last part activity is older than maxAgeDays,
// reclaiming the invisible space their parts hold. Interrupted uploads stay
// resumable within this window (docs/operations.md). SeaweedFS reports no
// Initiated timestamp, so uploads without parts cannot be dated; they hold no
// bytes and are left alone.
export const cleanupBucketUploads = async (
  s3: S3Client,
  bucket: string,
  maxAgeDays: number,
  now: Date,
): Promise<number> => {
  let aborted = 0
  for (const upload of await listAllUploads(s3, bucket)) {
    if (upload.Key === undefined || upload.UploadId === undefined) {
      continue
    }
    let lastActivity: Date | undefined
    for await (const parts of paginateListParts(
      { client: s3 },
      { Bucket: bucket, Key: upload.Key, UploadId: upload.UploadId },
    )) {
      for (const part of parts.Parts ?? []) {
        if (part.LastModified !== undefined
          && (lastActivity === undefined || part.LastModified > lastActivity)) {
          lastActivity = part.LastModified
        }
      }
    }
    if (lastActivity === undefined || !isOlderThanDays(lastActivity, maxAgeDays, now)) {
      continue
    }

    await s3.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: upload.Key,
        UploadId: upload.UploadId,
      }),
    )
    aborted += 1
  }

  return aborted
}
