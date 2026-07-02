/* eslint-disable vitest/expect-expect -- assertions live inside `expectNonEmptyLeaf` helper */
import { describe, expect, test } from "vitest"

import { en, flattenKeys, ja } from "~/lib/i18n"

const jaKeys = flattenKeys(ja).sort()
const enKeys = flattenKeys(en).sort()

const lookupValue = (resource: unknown, dotKey: string): unknown => {
  let current: unknown = resource
  for (const part of dotKey.split(".")) {
    if (current === null || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

describe("i18n resource parity", () => {
  test("i18n_jaEnKeySets_areEqual", () => {
    expect(enKeys).toEqual(jaKeys)
  })

  test("i18n_keyCount_isNonZero", () => {
    expect(jaKeys.length).toBeGreaterThan(0)
  })

  const expectNonEmptyLeaf = (value: unknown): void => {
    expect(typeof value).toBe("string")
    expect(value).not.toBe("")
  }

  // 有限 domain を random sample すると未翻訳 key が運悪く選ばれず素通りする。
  // test.each で全列挙する。
  test.each(jaKeys.map((k) => [k]))(
    "i18n_jaKey_%s_resolvesToNonEmptyString",
    (key) => {
      expectNonEmptyLeaf(lookupValue(ja, key))
    },
  )

  test.each(enKeys.map((k) => [k]))(
    "i18n_enKey_%s_resolvesToNonEmptyString",
    (key) => {
      expectNonEmptyLeaf(lookupValue(en, key))
    },
  )

  // ja value にひらがな・カタカナ・漢字が含まれているのに en value と完全一致 = 翻訳忘れ。
  const containsJapanese = (value: string): boolean => /[ぁ-んァ-ヶ一-龯]/.test(value)

  // 意図的に ja / en で同一文字列を用いるキー。
  // - switchLang.*: language switcher は対象言語そのものを表示する仕様
  const intentionalDuplicates = new Set<string>([
    "switchLang.toJa",
    "switchLang.toEn",
  ])

  const jaJapaneseLeaves = jaKeys.filter((key) => {
    if (intentionalDuplicates.has(key)) return false
    const jaValue = lookupValue(ja, key)
    return typeof jaValue === "string" && containsJapanese(jaValue)
  })

  test("i18n_translatableLeaves_existInResource", () => {
    expect(jaJapaneseLeaves.length).toBeGreaterThan(0)
  })

  test.each(jaJapaneseLeaves.map((k) => [k]))(
    "i18n_translatableKey_%s_jaAndEnLiteralsDiffer",
    (key) => {
      const jaValue = lookupValue(ja, key)
      const enValue = lookupValue(en, key)
      expect(jaValue).not.toBe(enValue)
    },
  )
})
