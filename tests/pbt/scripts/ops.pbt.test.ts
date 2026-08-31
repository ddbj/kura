import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

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
