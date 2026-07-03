import { describe, expect, test } from "vitest"

import { ResumeMismatchError, verifyCompletedParts } from "~/lib/s3/verify"

// Pre-computed MD5 hex of the part contents (node:crypto is unavailable in
// the jsdom project).
const MD5_PART1 = "2e9ec317e197819358fbc43afca7d837" // "01234567"
const MD5_PART2 = "3d6c946ea0da9f49ee4e017a66732f51" // "89abcdef"

describe("verifyCompletedParts", () => {
  const partSize = 8
  const bytes = new TextEncoder().encode("0123456789abcdef")
  const file = new File([bytes], "data.bin")

  test("verifyCompletedParts_matchingContent_passes", async () => {
    await expect(verifyCompletedParts({
      file,
      partSize,
      parts: [
        { partNumber: 1, size: 8, etag: `"${MD5_PART1}"` },
        { partNumber: 2, size: 8, etag: `"${MD5_PART2}"` },
      ],
    })).resolves.toBeUndefined()
  })

  test("verifyCompletedParts_differingContent_throwsMismatch", async () => {
    await expect(verifyCompletedParts({
      file,
      partSize,
      parts: [{ partNumber: 2, size: 8, etag: `"${MD5_PART1}"` }],
    })).rejects.toBeInstanceOf(ResumeMismatchError)
  })

  test("verifyCompletedParts_abortedSignal_throws", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(verifyCompletedParts({
      file,
      partSize,
      parts: [{ partNumber: 1, size: 8, etag: `"${MD5_PART1}"` }],
      signal: controller.signal,
    })).rejects.toThrow()
  })
})
