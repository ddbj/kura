// @vitest-environment jsdom
// sessionStorage が要るので、この 1 ファイルだけ jsdom で動かす。
import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import {
  addSessionPresigned,
  dropSessionPresigned,
  dropSessionPresignedUnder,
  listSessionPresigned,
} from "~/lib/session-presigned"

const BUCKET = "bucket-a"

type Seed = {
  bucket: string
  key: string
  url: string
  method: "GET" | "PUT"
  offsetMs: number
}

const seedArb: fc.Arbitrary<Seed> = fc.record({
  bucket: fc.constantFrom(BUCKET, "bucket-b"),
  key: fc.string({ minLength: 1, maxLength: 16 }),
  url: fc.webUrl(),
  method: fc.constantFrom<"GET" | "PUT">("GET", "PUT"),
  // 失効判定の境界で揺れないよう、現在時刻から 1 秒以上離す
  offsetMs: fc.oneof(
    fc.integer({ min: -600_000, max: -1_000 }),
    fc.integer({ min: 1_000, max: 600_000 }),
  ),
})

const seed = (entries: readonly Seed[]): void => {
  window.sessionStorage.clear()
  const now = Date.now()
  for (const e of entries) {
    addSessionPresigned({ bucket: e.bucket, key: e.key, url: e.url, method: e.method, expiresAt: now + e.offsetMs })
  }
}

const liveKeysOf = (entries: readonly Seed[]): Set<string> => {
  // 同じ (bucket, key) は後勝ちなので、最後に積んだ entry の生死で決まる
  const last = new Map<string, Seed>()
  for (const e of entries) last.set(`${e.bucket} ${e.key}`, e)

  return new Set(
    [...last.values()].filter((e) => e.bucket === BUCKET && e.offsetMs > 0).map((e) => e.key),
  )
}

describe("session presigned log properties", () => {
  test.prop([fc.array(seedArb, { maxLength: 24 })])(
    "sessionPresigned_anyEntries_listsLiveEntriesOfThatBucketOnly",
    (entries) => {
      seed(entries)
      const listed = listSessionPresigned(BUCKET)

      expect(new Set(listed.map((e) => e.key))).toEqual(liveKeysOf(entries))
      // 同じ key が二重に残らない
      expect(new Set(listed.map((e) => e.key)).size).toBe(listed.length)
    },
  )

  test.prop([fc.array(seedArb, { maxLength: 24 }), fc.array(fc.string({ maxLength: 16 }), { maxLength: 8 })])(
    "sessionPresigned_afterDrop_droppedKeysAreGoneAndOthersRemain",
    (entries, dropped) => {
      seed(entries)
      const before = new Set(listSessionPresigned(BUCKET).map((e) => e.key))

      dropSessionPresigned(BUCKET, dropped)
      const after = new Set(listSessionPresigned(BUCKET).map((e) => e.key))

      for (const key of dropped) expect(after.has(key)).toBe(false)
      for (const key of before) {
        if (!dropped.includes(key)) expect(after.has(key)).toBe(true)
      }
    },
  )

  test.prop([fc.array(seedArb, { maxLength: 24 }), fc.string({ maxLength: 8 })])(
    "sessionPresigned_afterDropUnder_onlyThatPrefixIsRemoved",
    (entries, prefix) => {
      seed(entries)
      const before = [...new Set(listSessionPresigned(BUCKET).map((e) => e.key))]

      dropSessionPresignedUnder(BUCKET, prefix)
      const after = new Set(listSessionPresigned(BUCKET).map((e) => e.key))

      for (const key of before) {
        expect(after.has(key)).toBe(!key.startsWith(prefix))
      }
    },
  )

  // 他の bucket の記録は、どの操作でも巻き添えにしない
  test.prop([fc.array(seedArb, { minLength: 1, maxLength: 24 })])(
    "sessionPresigned_operationsOnOneBucket_leaveTheOtherUntouched",
    (entries) => {
      seed(entries)
      const other = new Set(listSessionPresigned("bucket-b").map((e) => e.key))

      dropSessionPresigned(BUCKET, [...other])
      dropSessionPresignedUnder(BUCKET, "")

      expect(new Set(listSessionPresigned("bucket-b").map((e) => e.key))).toEqual(other)
    },
  )
})
