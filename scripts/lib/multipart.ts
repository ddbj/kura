import type { MultipartUpload, S3Client } from "@aws-sdk/client-s3"
import {
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  paginateListParts,
} from "@aws-sdk/client-s3"

import { isOlderThanDays } from "./time.ts"

const isNoSuchUpload = (err: unknown): boolean => err instanceof Error && err.name === "NoSuchUpload"

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

const latestPartActivity = async (
  s3: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<Date | undefined> => {
  let lastActivity: Date | undefined
  for await (const parts of paginateListParts({ client: s3 }, { Bucket: bucket, Key: key, UploadId: uploadId })) {
    for (const part of parts.Parts ?? []) {
      if (part.LastModified !== undefined
        && (lastActivity === undefined || part.LastModified > lastActivity)) {
        lastActivity = part.LastModified
      }
    }
  }

  return lastActivity
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
    const lastActivity = await latestPartActivity(s3, bucket, upload.Key, upload.UploadId)
    if (lastActivity === undefined || !isOlderThanDays(lastActivity, maxAgeDays, now)) {
      continue
    }

    // A resume in progress can add a part between the snapshot above and the
    // abort below; re-checking right before sending it narrows (does not
    // fully close) that window.
    const recheck = await latestPartActivity(s3, bucket, upload.Key, upload.UploadId)
    if (recheck !== undefined && recheck.getTime() > lastActivity.getTime()) {
      continue
    }

    try {
      await s3.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: upload.Key,
          UploadId: upload.UploadId,
        }),
      )
      aborted += 1
    } catch (err) {
      // The client completed the upload between the recheck above and this
      // abort; nothing left to reclaim, and the rest of the bucket's stale
      // uploads still need processing.
      if (!isNoSuchUpload(err)) {
        throw err
      }
    }
  }

  return aborted
}
