import { describe, expect, test, vi } from "vitest"

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

  test("verifyCompletedParts_moreThanConcurrencyLimitParts_runsUpToFourAtOnce", async () => {
    const partSize = 8
    const partCount = 6
    const manyFile = new File([new TextEncoder().encode("0".repeat(partSize * partCount))], "many.bin")
    const parts = Array.from({ length: partCount }, (_, i) => ({
      partNumber: i + 1,
      size: partSize,
      etag: "\"deadbeef\"", // never matches; only concurrency is under test here
    }))

    const EXPECTED_CONCURRENCY = 4
    let active = 0
    let peak = 0
    let releaseAll: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      releaseAll = resolve
    })
    const originalStream = Blob.prototype.stream
    const spy = vi.spyOn(Blob.prototype, "stream").mockImplementation(function (this: Blob) {
      active += 1
      peak = Math.max(peak, active)
      if (active >= EXPECTED_CONCURRENCY) releaseAll()
      const real = originalStream.call(this)

      return new ReadableStream({
        async start(controller) {
          await barrier
          const reader = real.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(value)
          }
          controller.close()
          active -= 1
        },
      })
    })

    await verifyCompletedParts({ file: manyFile, parts, partSize }).catch(() => undefined)
    spy.mockRestore()

    expect(peak).toBe(EXPECTED_CONCURRENCY)
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
