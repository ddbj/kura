import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { isPublicTagging } from "~/lib/s3/tags"

const otherTag = fc
  .record({ Key: fc.string(), Value: fc.string() })
  .filter((tag) => tag.Key !== "kura-public")
const otherTags = fc.array(otherTag, { maxLength: 5 })

describe("isPublicTagging properties", () => {
  test.prop([otherTags])("isPublicTagging_withoutKuraPublic_isFalse", (tags) => {
    expect(isPublicTagging(tags)).toBe(false)
  })

  test.prop([otherTags, fc.nat({ max: 5 })])(
    "isPublicTagging_kuraPublicTrueAnywhere_isTrue",
    (tags, pos) => {
      const idx = Math.min(pos, tags.length)
      const withPublic = [...tags.slice(0, idx), { Key: "kura-public", Value: "true" }, ...tags.slice(idx)]
      expect(isPublicTagging(withPublic)).toBe(true)
    },
  )

  // nginx は tag 値を "true" と完全一致で比較する ("false" や "True" は非公開)
  test.prop([otherTags, fc.string().filter((v) => v !== "true"), fc.nat({ max: 5 })])(
    "isPublicTagging_kuraPublicNonTrueValue_isFalse",
    (tags, value, pos) => {
      const idx = Math.min(pos, tags.length)
      const withNonTrue = [...tags.slice(0, idx), { Key: "kura-public", Value: value }, ...tags.slice(idx)]
      expect(isPublicTagging(withNonTrue)).toBe(false)
    },
  )

  test("isPublicTagging_undefinedTagSet_isFalse", () => {
    expect(isPublicTagging(undefined)).toBe(false)
  })
})
