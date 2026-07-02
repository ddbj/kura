import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { computePartSize } from "~/lib/s3/upload"

const MiB = 1024 * 1024
const MAX_PARTS = 10_000
// S3 の object 上限 5 TiB まで
const fileSize = fc.integer({ min: 0, max: 5 * 1024 * 1024 * MiB })

describe("computePartSize properties", () => {
  test.prop([fileSize])("computePartSize_coversWholeFileWithin10000Parts", (size) => {
    const partSize = computePartSize(size)
    expect(Number.isInteger(partSize)).toBe(true)
    expect(partSize).toBeGreaterThanOrEqual(5 * MiB)
    expect(partSize * MAX_PARTS).toBeGreaterThanOrEqual(size)
  })

  // 8 MiB * 10000 parts に収まるサイズまでは既定の part size を使う
  test.prop([fc.integer({ min: 0, max: 8 * MiB * MAX_PARTS })])(
    "computePartSize_withinDefaultCoverage_usesDefault",
    (size) => {
      expect(computePartSize(size)).toBe(8 * MiB)
    },
  )

  // 大きくする場合も必要最小限 (1 byte 小さいと 10000 parts に収まらない)
  test.prop([fileSize])("computePartSize_growsOnlyAsNeeded", (size) => {
    const partSize = computePartSize(size)
    fc.pre(partSize > 8 * MiB)
    expect((partSize - 1) * MAX_PARTS).toBeLessThan(size)
  })
})
