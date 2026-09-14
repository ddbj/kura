import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { formatDuration } from "~/lib/format"
import type { TFn } from "~/lib/i18n"

// Records which key was chosen and with which numbers, so the properties can
// assert on the decomposition instead of parsing localized copy.
type Call = { key: string; options: Record<string, unknown> }

const capture = (): { t: TFn; calls: Call[] } => {
  const calls: Call[] = []
  const t: TFn = (key, options) => {
    calls.push({ key, options: options ?? {} })

    return key
  }

  return { t, calls }
}

const numberOf = (call: Call, name: string): number => {
  const value = call.options[name]
  expect(typeof value).toBe("number")

  return value as number
}

describe("formatDuration properties", () => {
  // 表示された時間の合計が入力と一致すること。桁上がりの取りこぼし
  // (「1 時間 60 分」や「0 時間 90 分」) はここで落ちる。
  test.prop([fc.integer({ min: 1, max: 100_000 })])("formatDuration_anyMinutes_partsSumToInput", (minutes) => {
    const { t, calls } = capture()
    formatDuration(minutes, t)
    const call = calls[0] as Call
    if (call.key === "duration.minutes") {
      expect(numberOf(call, "minutes")).toBe(minutes)
    } else if (call.key === "duration.hours") {
      expect(numberOf(call, "hours") * 60).toBe(minutes)
    } else {
      expect(call.key).toBe("duration.hoursMinutes")
      expect(numberOf(call, "hours") * 60 + numberOf(call, "minutes")).toBe(minutes)
    }
  })

  test.prop([fc.integer({ min: 1, max: 100_000 })])("formatDuration_anyMinutes_minutePartStaysBelowAnHour", (minutes) => {
    const { t, calls } = capture()
    formatDuration(minutes, t)
    const call = calls[0] as Call
    if (call.key === "duration.minutes" || call.key === "duration.hoursMinutes") {
      const value = numberOf(call, "minutes")
      expect(value).toBeGreaterThan(0)
      expect(value).toBeLessThan(60)
    }
  })

  // 0 以下 (時計のズレで負になりうる) は「1 分」に丸めて、期限切れに見せない
  test.prop([fc.integer({ min: -100_000, max: 0 })])("formatDuration_nonPositive_isClampedToLessThanMinute", (minutes) => {
    const { t, calls } = capture()
    formatDuration(minutes, t)
    expect((calls[0] as Call).key).toBe("duration.lessThanMinute")
  })

  test.prop([fc.double({ min: 0, max: 10_000, noNaN: true })])("formatDuration_fractionalInput_neverEmitsFractionalParts", (minutes) => {
    const { t, calls } = capture()
    formatDuration(minutes, t)
    const call = calls[0] as Call
    for (const value of Object.values(call.options)) {
      expect(Number.isInteger(value)).toBe(true)
    }
  })
})
