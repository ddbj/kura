import type { S3Client } from "@aws-sdk/client-s3"

import { cleanupBucketUploads } from "./multipart.ts"
import { listBucketNames, opsS3Client } from "./s3.ts"
import { sweepBucketTtl } from "./ttl.ts"
import { purgeOldVersions } from "./versions.ts"

const parseDays = (name: string, raw: string): number => {
  const days = Number(raw)
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`)
  }

  return days
}

const daysEnv = (name: string, fallback: number): number => {
  const raw = process.env[name]

  return raw === undefined || raw === "" ? fallback : parseDays(name, raw)
}

// Empty means disabled (same contract as the SPA's baked file TTL).
const optionalDaysEnv = (name: string): number | null => {
  const raw = process.env[name]

  return raw === undefined || raw === "" ? null : parseDays(name, raw)
}

// One daily ops pass: file-TTL sweep (when enabled), removal of old versions
// in buckets with versioning on, and stale multipart cleanup. The version
// removal runs after the TTL sweep, which in such a bucket only leaves delete
// markers over the expired files.
export const runDaily = async (now: Date, s3: S3Client = opsS3Client()): Promise<void> => {
  const ttlDays = optionalDaysEnv("KURA_FILE_TTL_DAYS")
  const multipartMaxAgeDays = daysEnv("KURA_MULTIPART_MAX_AGE_DAYS", 7)

  const buckets = await listBucketNames(s3)
  let ttlDeleted = 0
  let versionsDeleted = 0
  let uploadsAborted = 0
  // One bucket's failure (transient S3 error, etc.) must not cost every other
  // bucket its TTL sweep / multipart cleanup.
  const failedBuckets: string[] = []
  for (const bucket of buckets) {
    try {
      if (ttlDays !== null) {
        const sweep = await sweepBucketTtl(s3, bucket, ttlDays, now)
        ttlDeleted += sweep.deleted
        // A delete that the server refused is a failure of this pass even
        // though nothing was thrown, so it has to reach the retry backoff.
        if (sweep.failed > 0) {
          failedBuckets.push(bucket)
          console.error(`kura-ops: bucket ${bucket}: ${sweep.failed} expired object(s) could not be deleted`)
          continue
        }
      }
      const purge = await purgeOldVersions(s3, bucket)
      if (purge.versioned) {
        versionsDeleted += purge.deleted
        // Named every day so the admin can see which user made such a bucket.
        console.log(`kura-ops: bucket ${bucket} has versioning on (created with Object Lock): deleted ${purge.deleted} old version(s) and delete marker(s)`)
        if (purge.failed > 0) {
          failedBuckets.push(bucket)
          console.error(`kura-ops: bucket ${bucket}: ${purge.failed} old version(s) could not be deleted`)
          continue
        }
      }
      uploadsAborted += await cleanupBucketUploads(s3, bucket, multipartMaxAgeDays, now)
    } catch (err) {
      failedBuckets.push(bucket)
      console.error(`kura-ops: bucket ${bucket} failed, continuing with the rest:`, err)
    }
  }

  console.log(
    `kura-ops: daily pass done: buckets=${buckets.length}`
    + ` ttlDeleted=${ttlDays === null ? "off" : ttlDeleted}`
    + ` versionsDeleted=${versionsDeleted}`
    + ` uploadsAborted=${uploadsAborted}`
    + (failedBuckets.length === 0 ? "" : ` failedBuckets=${failedBuckets.join(",")}`),
  )

  // Surfaced after everything else ran, so ops-loop.ts still logs the failure
  // without it blocking unrelated buckets.
  if (failedBuckets.length > 0) {
    throw new Error(
      `kura-ops: daily pass had failures in ${failedBuckets.length} bucket(s): ${failedBuckets.join(", ")}`,
    )
  }
}
