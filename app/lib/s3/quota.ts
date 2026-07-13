import type { ListObjectsV2CommandOutput, S3Client } from "@aws-sdk/client-s3"
import { ListObjectsV2Command } from "@aws-sdk/client-s3"

import { collectAllPages } from "./paginate"

// SeaweedFS supports server-side per-bucket quotas (`s3.bucket.quota`), but
// there is no S3 API to READ the currently-used bytes from the client. The
// browse view therefore tallies bytes by walking ListObjectsV2. Cached for
// several minutes via TanStack Query on the caller side.
export const listBucketTotalBytes = async (s3: S3Client, bucket: string): Promise<number> => {
  const sizes = await collectAllPages<ListObjectsV2CommandOutput, number, string>(
    (marker) => s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      ...(marker === undefined ? {} : { ContinuationToken: marker }),
    })),
    (page) => (page.Contents ?? []).map((o) => o.Size ?? 0),
    (page) => {
      const next = page.NextContinuationToken

      return next !== undefined && next !== "" ? next : undefined
    },
  )

  return sizes.reduce((sum, size) => sum + size, 0)
}

// Reference quota until the deployment exposes an authoritative value. Matches
// the docs default of 1 TB per user (docs/requirements.md § quota).
export const DEFAULT_QUOTA_BYTES = 1024 ** 4
