import { describe, expect, test } from "vitest"

import { formatDuration, formatSize } from "~/lib/format"
import { createI18nInstance, type Lang, type TFn } from "~/lib/i18n"

// Duration copy is assembled from i18n resources, so assert against the real
// instance rather than a stub: a broken plural form or a missing key would
// otherwise pass unnoticed.
const tFor = (lang: Lang): TFn => {
  const instance = createI18nInstance(lang)

  return (key, options) => (options === undefined ? instance.t(key) : instance.t(key, options)) as string
}

describe("formatSize", () => {
  test.each([
    [0, "0 B"],
    [1, "1 B"],
    [1023, "1023 B"],
    [1024, "1.0 KiB"],
    [1536, "1.5 KiB"],
    [1024 * 1024 - 1, "1024 KiB"],
    [1024 * 1024, "1.0 MiB"],
    [5 * 1024 * 1024 * 1024, "5.0 GiB"],
    [100 * 1024 ** 4, "100 TiB"],
  ])("formatSize_%i_is_%s", (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected)
  })
})

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
