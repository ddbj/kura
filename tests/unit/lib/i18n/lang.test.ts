import { describe, expect, test } from "vitest"

import { resolveInitialLang } from "~/lib/i18n/lang"

describe("resolveInitialLang", () => {
  test("resolveInitialLang_searchLang_winsOverStoredAndNavigator", () => {
    expect(resolveInitialLang({ searchLang: "en", storedLang: "ja", navigatorLanguage: "ja" })).toBe("en")
  })

  test("resolveInitialLang_invalidSearchLang_fallsThroughToStored", () => {
    expect(resolveInitialLang({ searchLang: "fr", storedLang: "en", navigatorLanguage: "ja" })).toBe("en")
    expect(resolveInitialLang({ searchLang: "", storedLang: "en", navigatorLanguage: "ja" })).toBe("en")
    expect(resolveInitialLang({ searchLang: "JA", storedLang: "en", navigatorLanguage: "ja" })).toBe("en")
  })

  test("resolveInitialLang_storedLang_winsOverNavigator", () => {
    expect(resolveInitialLang({ searchLang: null, storedLang: "en", navigatorLanguage: "ja" })).toBe("en")
  })

  test("resolveInitialLang_invalidStoredLang_fallsThroughToNavigator", () => {
    expect(resolveInitialLang({ searchLang: null, storedLang: "german", navigatorLanguage: "ja-JP" })).toBe("ja")
  })

  test("resolveInitialLang_navigatorJa_resolvesJa", () => {
    expect(resolveInitialLang({ searchLang: null, storedLang: null, navigatorLanguage: "ja" })).toBe("ja")
    expect(resolveInitialLang({ searchLang: null, storedLang: null, navigatorLanguage: "ja-JP" })).toBe("ja")
  })

  test("resolveInitialLang_navigatorNonJa_resolvesEn", () => {
    expect(resolveInitialLang({ searchLang: null, storedLang: null, navigatorLanguage: "en-US" })).toBe("en")
    expect(resolveInitialLang({ searchLang: null, storedLang: null, navigatorLanguage: "fr" })).toBe("en")
    expect(resolveInitialLang({ searchLang: null, storedLang: null, navigatorLanguage: "" })).toBe("en")
  })

  test("resolveInitialLang_navigatorJapaneseSubtag_isNotJa", () => {
    // "ja" プレフィックス判定が言語タグの区切りを無視しないこと (jam = Jamaican Creole)。
    expect(resolveInitialLang({ searchLang: null, storedLang: null, navigatorLanguage: "jam" })).toBe("en")
  })
})
