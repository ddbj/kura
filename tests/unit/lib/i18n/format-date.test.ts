import { describe, expect, test } from "vitest"

import { formatListDateTime } from "~/lib/i18n"

// Rows show a bare month/day for the current year and fall back to a full date
// otherwise, so a file from a previous year is never mistaken for a recent one.
// The time part always comes along, rendered in the browser's own timezone.
describe("formatListDateTime", () => {
  const now = new Date(2026, 8, 14)

  test("formatListDateTime_sameYearJa_omitsYear", () => {
    expect(formatListDateTime(new Date(2026, 0, 5, 9, 4), "ja", now)).toBe("01/05 09:04")
  })

  test("formatListDateTime_earlierYearJa_includesYear", () => {
    expect(formatListDateTime(new Date(2025, 11, 31, 23, 59), "ja", now)).toBe("2025/12/31 23:59")
  })

  test("formatListDateTime_sameYearEn_omitsYear", () => {
    expect(formatListDateTime(new Date(2026, 0, 5, 9, 4), "en", now)).toBe("01-05 09:04")
  })

  test("formatListDateTime_earlierYearEn_includesYear", () => {
    expect(formatListDateTime(new Date(2025, 11, 31, 23, 59), "en", now)).toBe("2025-12-31 23:59")
  })

  test("formatListDateTime_yearBoundary_switchesOnJanuaryFirst", () => {
    const lastDayOfPreviousYear = new Date(2025, 11, 31, 23, 59, 59)
    const firstDayOfThisYear = new Date(2026, 0, 1, 0, 0, 0)
    expect(formatListDateTime(lastDayOfPreviousYear, "ja", now)).toBe("2025/12/31 23:59")
    expect(formatListDateTime(firstDayOfThisYear, "ja", now)).toBe("01/01 00:00")
  })

  test("formatListDateTime_futureYear_includesYear", () => {
    expect(formatListDateTime(new Date(2027, 2, 1, 7, 30), "ja", now)).toBe("2027/03/01 07:30")
  })

  // 24 時間表記で、深夜は 24:00 ではなく 00:00 になる
  test("formatListDateTime_midnight_isZeroHour", () => {
    expect(formatListDateTime(new Date(2026, 5, 1, 0, 0), "ja", now)).toBe("06/01 00:00")
    expect(formatListDateTime(new Date(2026, 5, 1, 13, 5), "ja", now)).toBe("06/01 13:05")
  })
})
