import type { S3Client } from "@aws-sdk/client-s3"
import { ListObjectsV2Command } from "@aws-sdk/client-s3"

// SeaweedFS supports server-side per-bucket quotas (`s3.bucket.quota`), but
// there is no S3 API to READ the currently-used bytes from the client. The
// browse view therefore tallies bytes by walking ListObjectsV2. Cached for
// several minutes via TanStack Query on the caller side.
export const listBucketTotalBytes = async (s3: S3Client, bucket: string): Promise<number> => {
  let total = 0
  let token: string | undefined
  for (;;) {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      ...(token === undefined ? {} : { ContinuationToken: token }),
    }))
    for (const o of res.Contents ?? []) {
      total += o.Size ?? 0
    }
    if (res.IsTruncated !== true) return total
    token = res.NextContinuationToken
  }
}

// Reference quota until the deployment exposes an authoritative value. Matches
// the docs default of 1 TB per user (docs/requirements.md § quota).
export const DEFAULT_QUOTA_BYTES = 1024 ** 4
