import type { S3Client } from "@aws-sdk/client-s3"
import { DeleteObjectsCommand, paginateListObjectsV2 } from "@aws-sdk/client-s3"

import { isOlderThanDays } from "./time.ts"

const DELETE_BATCH = 1000

// Folder-persistence marker created by the SPA when a user makes an empty
// folder (there is no S3 API for empty prefixes; a zero-byte .keep object
// under the prefix keeps the folder listable). TTL must skip these or empty
// folders would evaporate on their own age.
const isFolderKeepMarker = (key: string): boolean =>
  key === ".keep" || key.endsWith("/.keep")

// Deletes objects past the file TTL (docs/operations.md). Creation time is
// the S3 LastModified, the same basis as the SPA expiry column.
export const sweepBucketTtl = async (
  s3: S3Client,
  bucket: string,
  ttlDays: number,
  now: Date,
): Promise<number> => {
  const expired: string[] = []
  for await (const page of paginateListObjectsV2({ client: s3 }, { Bucket: bucket })) {
    for (const object of page.Contents ?? []) {
      if (
        object.Key !== undefined
        && !isFolderKeepMarker(object.Key)
        && object.LastModified !== undefined
        && isOlderThanDays(object.LastModified, ttlDays, now)
      ) {
        expired.push(object.Key)
      }
    }
  }

  let deleted = 0
  for (let i = 0; i < expired.length; i += DELETE_BATCH) {
    const batch = expired.slice(i, i + DELETE_BATCH)
    let res
    try {
      res = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      )
    } catch (err) {
      // Keeps prior batches' counts intact instead of losing them to a
      // thrown rejection; this batch's objects are treated as not deleted.
      console.error(`kura-ops: ttl delete batch failed: ${bucket}: ${String(err)}`)
      continue
    }
    const failed = res.Errors ?? []
    for (const error of failed) {
      console.error(`kura-ops: ttl delete failed: ${bucket}/${error.Key ?? "?"}: ${error.Message ?? "?"}`)
    }
    deleted += batch.length - failed.length
  }

  return deleted
}
