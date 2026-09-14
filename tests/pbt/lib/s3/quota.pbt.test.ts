import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { type BucketObjectStat, foldBucketStats } from "~/lib/s3/quota"

// key は「セグメント / 区切り」で作る。区切り文字そのものを含む名前や、
// 深い階層、同じ prefix を共有する兄弟が混ざるようにしておく。
const keyArb = fc.array(fc.constantFrom("a", "b", "ab", "a-2", "x y"), { minLength: 1, maxLength: 4 })
  .map((segments) => segments.join("/"))

const objectArb: fc.Arbitrary<BucketObjectStat> = fc.record({
  key: keyArb,
  size: fc.integer({ min: 0, max: 1_000_000 }),
  lastModifiedMs: fc.integer({ min: 0, max: 2_000_000_000_000 }),
})

const ancestorsOf = (key: string): string[] => {
  const out: string[] = []
  for (let slash = key.indexOf("/"); slash !== -1; slash = key.indexOf("/", slash + 1)) {
    out.push(key.slice(0, slash + 1))
  }

  return out
}

describe("foldBucketStats properties", () => {
  test.prop([fc.array(objectArb, { maxLength: 40 })])(
    "foldBucketStats_totalBytes_equalsSumOfAllObjects",
    (objects) => {
      const expected = objects.reduce((sum, o) => sum + o.size, 0)

      expect(foldBucketStats(objects).totalBytes).toBe(expected)
    },
  )

  // 各フォルダの値は「その prefix で始まる object 全部」から決まる
  test.prop([fc.array(objectArb, { maxLength: 40 })])(
    "foldBucketStats_everyFolder_matchesItsSubtree",
    (objects) => {
      const { folders } = foldBucketStats(objects)
      for (const [prefix, stat] of folders) {
        const subtree = objects.filter((o) => o.key.startsWith(prefix))
        expect(subtree.length).toBeGreaterThan(0)
        expect(stat.bytes).toBe(subtree.reduce((sum, o) => sum + o.size, 0))
        expect(stat.lastModifiedMs).toBe(Math.max(...subtree.map((o) => o.lastModifiedMs)))
      }
    },
  )

  // 逆向き: object の祖先はすべて folders に現れる (深い階層の取りこぼしが無い)
  test.prop([fc.array(objectArb, { maxLength: 40 })])(
    "foldBucketStats_everyAncestorOfEveryObject_isPresent",
    (objects) => {
      const { folders } = foldBucketStats(objects)
      for (const object of objects) {
        for (const ancestor of ancestorsOf(object.key)) {
          expect(folders.has(ancestor)).toBe(true)
        }
      }
    },
  )

  test.prop([fc.array(objectArb, { maxLength: 40 })])(
    "foldBucketStats_folderKeys_alwaysEndWithSlash",
    (objects) => {
      for (const prefix of foldBucketStats(objects).folders.keys()) {
        expect(prefix.endsWith("/")).toBe(true)
      }
    },
  )

  // ルート直下のファイルだけならフォルダは 1 つも生えない
  test.prop([fc.array(fc.record({
    key: fc.constantFrom("a.txt", "b.bin", "c"),
    size: fc.integer({ min: 0, max: 1000 }),
    lastModifiedMs: fc.integer({ min: 0, max: 2_000_000_000_000 }),
  }), { maxLength: 10 })])(
    "foldBucketStats_flatBucket_hasNoFolders",
    (objects) => {
      expect(foldBucketStats(objects).folders.size).toBe(0)
    },
  )
})
