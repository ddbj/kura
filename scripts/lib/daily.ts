import { access } from "node:fs/promises"

import { rotateAuditLogs } from "./audit-logs.ts"
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

// Empty means disabled (same contract as the SPA's /_config.json).
const optionalDaysEnv = (name: string): number | null => {
  const raw = process.env[name]

  return raw === undefined || raw === "" ? null : parseDays(name, raw)
}

// One daily ops pass (docs/operations.md): file-TTL sweep (when enabled),
// stale multipart cleanup, and audit log rotation.
export const runDaily = async (now: Date): Promise<void> => {
  const ttlDays = optionalDaysEnv("KURA_FILE_TTL_DAYS")
  const multipartMaxAgeDays = daysEnv("KURA_MULTIPART_MAX_AGE_DAYS", 7)
  const auditRetentionDays = daysEnv("KURA_AUDIT_RETENTION_DAYS", 1095)
  const auditLogDir = process.env["KURA_AUDIT_LOG_DIR"] ?? "/var/log/kura"

  const s3 = opsS3Client()
  const buckets = await listBucketNames(s3)
  let ttlDeleted = 0
  let uploadsAborted = 0
  for (const bucket of buckets) {
    if (ttlDays !== null) {
      ttlDeleted += await sweepBucketTtl(s3, bucket, ttlDays, now)
    }
    uploadsAborted += await cleanupBucketUploads(s3, bucket, multipartMaxAgeDays, now)
  }

  const logs = await access(auditLogDir).then(
    () => rotateAuditLogs(auditLogDir, auditRetentionDays, now),
    () => null,
  )

  console.log(
    `kura-ops: daily pass done: buckets=${buckets.length}`
    + ` ttlDeleted=${ttlDays === null ? "off" : ttlDeleted}`
    + ` uploadsAborted=${uploadsAborted}`
    + ` logs=${logs === null ? "off" : `compressed:${logs.compressed} deleted:${logs.deleted}`}`,
  )
}
