import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import type { UploadedPart } from "~/lib/s3/multipart"
import { planResume } from "~/lib/s3/resume"
import { computePartSize } from "~/lib/s3/upload"

const MiB = 1024 * 1024
// 8 MiB 固定領域と、part size が成長する 100 GB クラスの両方を踏む
const fileSize = fc.oneof(
  fc.integer({ min: 1, max: 64 * MiB }),
  fc.integer({ min: 80 * 1024 * MiB, max: 120 * 1024 * MiB }),
)

const layoutOf = (size: number) => {
  const partSize = computePartSize(size)
  const totalParts = Math.ceil(size / partSize)

  return { partSize, totalParts, lastPartSize: size - partSize * (totalParts - 1) }
}

// 中断時と同じファイルから来た「正しい完了 part 集合」を作る
const completedPartsFor = (size: number, partNumbers: number[]): UploadedPart[] => {
  const { partSize, totalParts, lastPartSize } = layoutOf(size)

  return partNumbers.map((partNumber) => ({
    partNumber,
    size: partNumber === totalParts ? lastPartSize : partSize,
    etag: `"etag-${partNumber}"`,
  }))
}

const fileWithParts = fileSize.chain((size) =>
  fc.tuple(
    fc.constant(size),
    fc.uniqueArray(fc.integer({ min: 1, max: layoutOf(size).totalParts }), { maxLength: 30 }),
  ),
)

describe("planResume properties", () => {
  test.prop([fileWithParts])(
    "planResume_consistentParts_partitionsTheFileExactly",
    ([size, partNumbers]) => {
      const parts = completedPartsFor(size, partNumbers)
      const planned = planResume({ fileSize: size, parts })
      expect(planned.ok).toBe(true)
      if (!planned.ok) return
      const { plan } = planned

      // 完了 + 残りが part 番号全体をちょうど分割する（toEqual は 1 万要素で
      // 遅すぎるため素の比較で検査する）
      const covered = [
        ...plan.completed.map((p) => p.partNumber),
        ...plan.remaining.map((r) => r.partNumber),
      ].sort((a, b) => a - b)
      expect(covered.length).toBe(plan.totalParts)
      expect(covered.every((n, i) => n === i + 1)).toBe(true)

      // バイト数も過不足なくファイル全体を覆う
      const remainingBytes = plan.remaining.reduce((sum, r) => sum + (r.end - r.start), 0)
      expect(plan.completedBytes + remainingBytes).toBe(size)
      const rangesValid = plan.remaining.every((range) =>
        range.start === (range.partNumber - 1) * plan.partSize
        && range.end > range.start
        && range.end <= size)
      expect(rangesValid).toBe(true)
    },
  )

  test.prop([
    fileWithParts.filter(([, partNumbers]) => partNumbers.length > 0),
    fc.integer({ min: 1, max: 1024 }),
    fc.boolean(),
  ])(
    "planResume_partSizeAltered_rejects",
    ([size, partNumbers], delta, grow) => {
      const parts = completedPartsFor(size, partNumbers)
      const target = parts[0]!
      // grow=false で size を割ると 0 以下になり得るので 1 byte を下限にずらす
      target.size = grow ? target.size + delta : Math.max(1, target.size - delta)
      fc.pre(target.size !== completedPartsFor(size, [target.partNumber])[0]!.size)

      expect(planResume({ fileSize: size, parts }).ok).toBe(false)
    },
  )

  test.prop([fileWithParts])(
    "planResume_partBeyondLayout_rejects",
    ([size, partNumbers]) => {
      const { totalParts, partSize } = layoutOf(size)
      const parts = [
        ...completedPartsFor(size, partNumbers),
        { partNumber: totalParts + 1, size: partSize, etag: "\"beyond\"" },
      ]

      expect(planResume({ fileSize: size, parts }).ok).toBe(false)
    },
  )

  test("rejects an empty file and duplicated part numbers", () => {
    expect(planResume({ fileSize: 0, parts: [] }).ok).toBe(false)
    const [part] = completedPartsFor(10 * MiB, [1])
    expect(planResume({ fileSize: 10 * MiB, parts: [part!, { ...part! }] }).ok).toBe(false)
  })
})
