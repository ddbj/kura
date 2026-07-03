import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { auditFileDate } from "../../../scripts/lib/audit-logs.ts"
import { DAY_MS, isOlderThanDays } from "../../../scripts/lib/time.ts"

describe("isOlderThanDays", () => {
  test.prop([
    fc.date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true }),
    fc.integer({ min: 1, max: 10_000 }),
  ])("date_agedExactlyDays_isTheBoundaryAndOlder", (date, days) => {
    const boundary = new Date(date.getTime() + days * DAY_MS)
    expect(isOlderThanDays(date, days, boundary)).toBe(true)
    expect(isOlderThanDays(date, days, new Date(boundary.getTime() - 1))).toBe(false)
    expect(isOlderThanDays(date, days, new Date(boundary.getTime() + 1))).toBe(true)
  })
})

describe("auditFileDate", () => {
  test.prop([
    fc.date({
      min: new Date("1000-01-01"),
      max: new Date("9999-12-31"),
      noInvalidDate: true,
    }),
    fc.boolean(),
  ])("name_wellFormedDate_parsesToUtcMidnight", (date, gz) => {
    const day = date.toISOString().slice(0, 10)
    const parsed = auditFileDate(`access-${day}.log${gz ? ".gz" : ""}`)
    expect(parsed?.toISOString()).toBe(`${day}T00:00:00.000Z`)
  })

  // 受理集合は access-YYYY-MM-DD.log(.gz) だけ。それ以外のファイルには触らない
  test.prop([fc.string()])("name_arbitraryString_acceptedIffAuditPattern", (name) => {
    const parsed = auditFileDate(name)
    const wellFormed = /^access-\d{4}-\d{2}-\d{2}\.log(\.gz)?$/.test(name)
    if (!wellFormed) {
      expect(parsed).toBeNull()
    }
  })

  test("rejects calendar-invalid dates", () => {
    expect(auditFileDate("access-2026-13-01.log")).toBeNull()
    expect(auditFileDate("access-2026-00-10.log")).toBeNull()
  })
})
