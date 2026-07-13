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

  test("verifyCompletedParts_manyParts_stillCatchesAMismatchAfterTheFirstBatch", async () => {
    const bigPartSize = 8
    const bigBytes = new TextEncoder().encode("01234567".repeat(6))
    const bigFile = new File([bigBytes], "many.bin")
    // 6 parts, all matching except the 5th (past the 4-wide concurrency batch).
    const parts = Array.from({ length: 6 }, (_, i) => ({
      partNumber: i + 1,
      size: bigPartSize,
      etag: i === 4 ? `"${MD5_PART2}"` : `"${MD5_PART1}"`,
    }))
    await expect(verifyCompletedParts({ file: bigFile, parts, partSize: bigPartSize }))
      .rejects.toBeInstanceOf(ResumeMismatchError)
  })

  test("verifyCompletedParts_moreThanConcurrencyLimitParts_verifiesEveryOne", async () => {
    // Three times the internal concurrency limit (4). "All-match resolves"
    // proves the whole queue drains, not just the first batch, without
    // coupling the test to the specific scheduling.
    const partSize = 8
    const partCount = 12
    const manyBytes = new TextEncoder().encode("01234567".repeat(partCount))
    const manyFile = new File([manyBytes], "many.bin")
    const matching = Array.from({ length: partCount }, (_, i) => ({
      partNumber: i + 1,
      size: partSize,
      etag: `"${MD5_PART1}"`,
    }))
    await expect(verifyCompletedParts({ file: manyFile, parts: matching, partSize }))
      .resolves.toBeUndefined()

    // Flip only the last part: if the queue stopped at the first batch, this
    // mismatch would slip through and the promise would still resolve.
    const withTailMismatch = matching.map((p, i) =>
      i === partCount - 1 ? { ...p, etag: `"${MD5_PART2}"` } : p,
    )
    await expect(verifyCompletedParts({ file: manyFile, parts: withTailMismatch, partSize }))
      .rejects.toBeInstanceOf(ResumeMismatchError)
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
