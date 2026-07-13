import { createReadStream, createWriteStream } from "node:fs"
import { readdir, unlink } from "node:fs/promises"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { createGzip } from "node:zlib"

import { isOlderThanDays } from "./time.ts"

// nginx writes access-YYYY-MM-DD.log (docs/operations.md); this module owns
// the .log.gz files it produces from them.
const AUDIT_FILE = /^access-(\d{4}-\d{2}-\d{2})\.log(\.gz)?$/

export const auditFileDate = (name: string): Date | null => {
  const matched = AUDIT_FILE.exec(name)
  if (matched === null) {
    return null
  }
  const date = new Date(`${matched[1]}T00:00:00Z`)

  return Number.isNaN(date.getTime()) ? null : date
}

const isCompressed = (name: string): boolean => name.endsWith(".gz")

// Seconds since UTC midnight for the given instant.
const secondsSinceUtcMidnight = (now: Date): number =>
  now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()

const isYesterday = (fileDate: Date, now: Date): boolean => {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const oneDayMs = 24 * 60 * 60 * 1000

  return fileDate.getTime() === todayUtc - oneDayMs
}

// Compresses finished (non-today) plain logs and deletes files past the
// retention window. Re-running after a crash is safe: gzip overwrites any
// partial output before the plain file is removed.
//
// nginx opens the date-stamped log path per request and caches the fd in
// open_log_file_cache (kura.conf.template: inactive=60s). Right after UTC
// midnight the worker may still hold yesterday's fd; gzipping+unlinking then
// leaves the worker writing to a deleted inode. rotateLagSeconds delays
// yesterday's rotation until every cached fd has aged out. Older days are
// safe to rotate unconditionally.
export const rotateAuditLogs = async (
  dir: string,
  retentionDays: number,
  now: Date,
  rotateLagSeconds = 120,
): Promise<{ compressed: number; deleted: number }> => {
  const today = now.toISOString().slice(0, 10)
  const withinLag = secondsSinceUtcMidnight(now) < rotateLagSeconds
  let compressed = 0
  let deleted = 0

  for (const name of await readdir(dir)) {
    const date = auditFileDate(name)
    if (date === null) {
      continue
    }
    const path = join(dir, name)

    if (isOlderThanDays(date, retentionDays, now)) {
      await unlink(path)
      deleted += 1
      continue
    }

    if (!isCompressed(name) && !name.startsWith(`access-${today}.`)) {
      if (withinLag && isYesterday(date, now)) {
        continue
      }
      await pipeline(createReadStream(path), createGzip(), createWriteStream(`${path}.gz`))
      await unlink(path)
      compressed += 1
    }
  }

  return { compressed, deleted }
}
