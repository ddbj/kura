import type { S3Client } from "@aws-sdk/client-s3"

import { cleanupBucketUploads } from "./multipart.ts"
import { listBucketNames, opsS3Client } from "./s3.ts"
import { sweepBucketTtl } from "./ttl.ts"

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

// One daily ops pass: file-TTL sweep (when enabled) and
// stale multipart cleanup.
export const runDaily = async (now: Date, s3: S3Client = opsS3Client()): Promise<void> => {
  const ttlDays = optionalDaysEnv("KURA_FILE_TTL_DAYS")
  const multipartMaxAgeDays = daysEnv("KURA_MULTIPART_MAX_AGE_DAYS", 7)

  const buckets = await listBucketNames(s3)
  let ttlDeleted = 0
  let uploadsAborted = 0
  // One bucket's failure (transient S3 error, etc.) must not cost every other
  // bucket its TTL sweep / multipart cleanup.
  const failedBuckets: string[] = []
  for (const bucket of buckets) {
    try {
      if (ttlDays !== null) {
        ttlDeleted += await sweepBucketTtl(s3, bucket, ttlDays, now)
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
