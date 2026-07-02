import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { isLang, resolveInitialLang } from "~/lib/i18n/lang"

const maybeString = fc.option(fc.string(), { nil: null })

describe("resolveInitialLang properties", () => {
  test.prop([maybeString, maybeString, fc.string()])(
    "resolveInitialLang_anyInput_returnsValidLang",
    (searchLang, storedLang, navigatorLanguage) => {
      expect(isLang(resolveInitialLang({ searchLang, storedLang, navigatorLanguage }))).toBe(true)
    },
  )

  test.prop([fc.constantFrom("ja" as const, "en" as const), maybeString, fc.string()])(
    "resolveInitialLang_validSearchLang_alwaysWins",
    (searchLang, storedLang, navigatorLanguage) => {
      expect(resolveInitialLang({ searchLang, storedLang, navigatorLanguage })).toBe(searchLang)
    },
  )

  test.prop([
    fc.string().filter((s) => !isLang(s)),
    fc.constantFrom("ja" as const, "en" as const),
    fc.string(),
  ])(
    "resolveInitialLang_invalidSearchValidStored_storedWins",
    (searchLang, storedLang, navigatorLanguage) => {
      expect(resolveInitialLang({ searchLang, storedLang, navigatorLanguage })).toBe(storedLang)
    },
  )

  test.prop([fc.string().filter((s) => !isLang(s)), fc.string().filter((s) => !isLang(s))])(
    "resolveInitialLang_noValidHints_dependsOnlyOnNavigatorJa",
    (searchLang, storedLang) => {
      expect(resolveInitialLang({ searchLang, storedLang, navigatorLanguage: "ja-JP" })).toBe("ja")
      expect(resolveInitialLang({ searchLang, storedLang, navigatorLanguage: "en-GB" })).toBe("en")
    },
  )
})
