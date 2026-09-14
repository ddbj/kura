import { describe, expect, test } from "vitest"

// vite の raw glob でソースそのものを読む。jsdom 環境なので node:fs は使えず、
// またこうしておくとファイルが増えても対象に自動で入る。
const sources = import.meta.glob("/app/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

// The resource files are where the Japanese copy is supposed to live.
const EXCLUDED_PREFIX = "/app/lib/i18n/resources/"

// Comments stay Japanese; only code (literals, JSX text) has to go through
// i18n, so strip comments before looking for Japanese characters.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n")

const JAPANESE = /[぀-ゟ゠-ヿ一-鿿]/

describe("UI copy is fully localized", () => {
  const files = Object.keys(sources).filter((path) => !path.startsWith(EXCLUDED_PREFIX)).sort()

  test("localizedUi_appSources_areDiscovered", () => {
    expect(files.length).toBeGreaterThan(20)
  })

  test.each(files.map((f) => [f]))("localizedUi_%s_hasNoJapaneseLiteral", (path) => {
    const offenders = stripComments(sources[path] as string)
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => JAPANESE.test(line))
      .map(([lineNo, line]) => `${path}:${lineNo}: ${line.trim()}`)

    expect(offenders).toEqual([])
  })
})
