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

// Compresses finished (non-today) plain logs and deletes files past the
// retention window. Re-running after a crash is safe: gzip overwrites any
// partial output before the plain file is removed.
export const rotateAuditLogs = async (
  dir: string,
  retentionDays: number,
  now: Date,
): Promise<{ compressed: number; deleted: number }> => {
  const today = now.toISOString().slice(0, 10)
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
      await pipeline(createReadStream(path), createGzip(), createWriteStream(`${path}.gz`))
      await unlink(path)
      compressed += 1
    }
  }

  return { compressed, deleted }
}
