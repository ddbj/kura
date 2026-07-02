import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { isUsableBucketName } from "~/lib/s3/bucket-name"

// SeaweedFS VerifyS3BucketName (docs/architecture.md「配置」) と同じ受理集合の
// ASCII 部分集合を生成する。
const bucketChar = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789")
const validName = fc
  .tuple(bucketChar, fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789.-"), minLength: 1, maxLength: 61 }), bucketChar)
  .map(([head, mid, tail]) => `${head}${mid}${tail}`)
  .filter((name) =>
    !name.includes("..") &&
    !name.startsWith("xn--") &&
    !name.endsWith("-s3alias") &&
    name !== "filemeta" &&
    !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name))

describe("isUsableBucketName properties", () => {
  test.prop([validName])("isUsableBucketName_generatedValidName_isAccepted", (name) => {
    expect(isUsableBucketName(name)).toBe(true)
  })

  test.prop([fc.string()])("isUsableBucketName_anyString_returnsBoolean", (name) => {
    expect(typeof isUsableBucketName(name)).toBe("boolean")
  })

  // DDBJ username 規則 (先頭は小文字英数、a-z 0-9 _ -) のうち "_" を含むものは
  // 全部 bucket 名にならない。
  test.prop([validName, fc.nat({ max: 10 })])(
    "isUsableBucketName_underscoreAnywhere_isRejected",
    (name, pos) => {
      const idx = Math.min(pos, name.length)
      expect(isUsableBucketName(`${name.slice(0, idx)}_${name.slice(idx)}`)).toBe(false)
    },
  )
})
