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

// Confirms the local file really is the one the parts came from: SeaweedFS
// part ETags are plain MD5, so hash the corresponding byte ranges and
// compare. Runs alongside the remaining-part uploads (both must succeed
// before CompleteMultipartUpload); MD5 is not in WebCrypto, hence hash-wasm,
// loaded lazily to keep it out of the main bundle.
export const verifyCompletedParts = async ({ file, parts, partSize, signal }: {
  file: File
  parts: UploadedPart[]
  partSize: number
  signal?: AbortSignal
}): Promise<void> => {
  if (parts.length === 0) return
  const { createMD5 } = await import("hash-wasm")
  const hasher = await createMD5()

  for (const part of parts) {
    signal?.throwIfAborted()
    const start = (part.partNumber - 1) * partSize
    hasher.init()
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
}
