import { describe, expect, test } from "vitest"

import { formatSize } from "~/lib/format"

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
