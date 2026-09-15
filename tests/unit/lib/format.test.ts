import { describe, expect, test } from "vitest"

import { formatDuration } from "~/lib/format"
import { createI18nInstance, type Lang, type TFn } from "~/lib/i18n"

// Duration copy is assembled from i18n resources, so assert against the real
// instance rather than a stub: a broken plural form or a missing key would
// otherwise pass unnoticed.
const tFor = (lang: Lang): TFn => {
  const instance = createI18nInstance(lang)

  return (key, options) => (options === undefined ? instance.t(key) : instance.t(key, options)) as string
}

describe("formatDuration", () => {
  const ja = tFor("ja")
  const en = tFor("en")

  test.each([
    [-30, "1 分"],
    [0, "1 分"],
    [0.4, "1 分"],
    [1, "1 分"],
    [59, "59 分"],
    [60, "1 時間"],
    [61, "1 時間 1 分"],
    [119, "1 時間 59 分"],
    [120, "2 時間"],
    [596, "9 時間 56 分"],
    [720, "12 時間"],
  ])("formatDuration_ja_%p_is_%s", (minutes, expected) => {
    expect(formatDuration(minutes, ja)).toBe(expected)
  })

  test.each([
    [0, "1 min"],
    [45, "45 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
    [720, "12 h"],
  ])("formatDuration_en_%p_is_%s", (minutes, expected) => {
    expect(formatDuration(minutes, en)).toBe(expected)
  })

  test("formatDuration_fractionalMinutes_roundToNearest", () => {
    expect(formatDuration(59.6, ja)).toBe("1 時間")
    expect(formatDuration(60.4, ja)).toBe("1 時間")
    expect(formatDuration(60.6, ja)).toBe("1 時間 1 分")
  })
})
