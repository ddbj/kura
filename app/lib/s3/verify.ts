import type { UploadedPart } from "./multipart"

// The re-selected file does not match the interrupted upload (wrong size,
// inconsistent parts, or differing content). Completing would corrupt the
// object, so the resume path stops and keeps the parts.
export class ResumeMismatchError extends Error {
  constructor(reason: string) {
    super(`resume mismatch: ${reason}`)
    this.name = "ResumeMismatchError"
  }
}

const etagHex = (etag: string): string => etag.replaceAll("\"", "").toLowerCase()

// Matches the upload side's part concurrency (app/lib/s3/resume.ts).
const CONCURRENCY = 4

const verifyPart = async (
  file: File,
  partSize: number,
  part: UploadedPart,
  signal?: AbortSignal,
): Promise<void> => {
  const { createMD5 } = await import("hash-wasm")
  const hasher = await createMD5()
  const start = (part.partNumber - 1) * partSize
  const reader = file.slice(start, start + part.size).stream().getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    signal?.throwIfAborted()
    hasher.update(value)
  }
  if (hasher.digest("hex") !== etagHex(part.etag)) {
    throw new ResumeMismatchError(`part ${part.partNumber} content differs`)
  }
}

// Confirms the local file really is the one the parts came from: SeaweedFS
// part ETags are plain MD5, so hash the corresponding byte ranges and
// compare. Runs alongside the remaining-part uploads (both must succeed
// before CompleteMultipartUpload); MD5 is not in WebCrypto, hence hash-wasm,
// loaded lazily to keep it out of the main bundle. Parts are independent, so
// they verify CONCURRENCY at a time instead of one by one.
export const verifyCompletedParts = async ({ file, parts, partSize, signal }: {
  file: File
  parts: UploadedPart[]
  partSize: number
  signal?: AbortSignal
}): Promise<void> => {
  const queue = [...parts]
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async (): Promise<void> => {
    for (let part = queue.shift(); part !== undefined; part = queue.shift()) {
      signal?.throwIfAborted()
      await verifyPart(file, partSize, part, signal)
    }
  })
  await Promise.all(workers)
}
