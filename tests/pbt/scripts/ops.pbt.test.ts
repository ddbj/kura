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

  // 受理集合は access-YYYY-MM-DD.log(.gz) だけで、かつ受理時は日付を UTC 深夜として
  // 復元する。iff 両向き (unmatched -> null, matched -> parseable date) を確認する。
  test.prop([fc.string()])("name_arbitraryString_acceptedIffAuditPattern", (name) => {
    const parsed = auditFileDate(name)
    const matched = /^access-(\d{4}-\d{2}-\d{2})\.log(\.gz)?$/.exec(name)
    if (matched === null) {
      expect(parsed).toBeNull()

      return
    }
    const day = matched[1]!
    // Reject calendar-invalid days like 2026-02-30 (Date normalises them),
    // as the impl does; the parsed value round-trips to the exact same day.
    const expected = new Date(`${day}T00:00:00Z`)
    if (expected.toISOString().slice(0, 10) !== day) {
      expect(parsed).toBeNull()

      return
    }
    expect(parsed).not.toBeNull()
    expect(parsed?.toISOString()).toBe(`${day}T00:00:00.000Z`)
  })

  test("rejects calendar-invalid dates", () => {
    expect(auditFileDate("access-2026-13-01.log")).toBeNull()
    expect(auditFileDate("access-2026-00-10.log")).toBeNull()
  })
})
