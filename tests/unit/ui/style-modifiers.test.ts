import { describe, expect, test } from "vitest"

// `cn("base", { mod: cond })` の mod は base と組み合わせて使う前提の修飾子名。
// 同じ名前で単独のクラスが CSS にあると、詳細度が同じで後勝ちになり、base 側の
// 指定（背景・padding・角丸など）を丸ごと奪う。その組み合わせが起こりえない
// ことを検査で固定する。
const sources = import.meta.glob("/app/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

const stylesheets = import.meta.glob("/app/styles/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

const modifierNames = (): Map<string, string[]> => {
  const found = new Map<string, string[]>()
  for (const [path, src] of Object.entries(sources)) {
    for (const call of src.matchAll(/cn\(([\s\S]*?)\)\s*[,}\n]/g)) {
      for (const key of (call[1] ?? "").matchAll(/[{,]\s*"?([A-Za-z][\w-]*)"?\s*:/g)) {
        const name = key[1] as string
        found.set(name, [...(found.get(name) ?? []), path])
      }
    }
  }

  return found
}

const standaloneClasses = (): Set<string> => {
  const names = new Set<string>()
  for (const css of Object.values(stylesheets)) {
    for (const rule of css.matchAll(/(?:^|\})([^{}]+)\{/g)) {
      for (const selector of (rule[1] ?? "").split(",")) {
        const trimmed = selector.trim()
        if (/^\.[A-Za-z][\w-]*$/.test(trimmed)) names.add(trimmed.slice(1))
      }
    }
  }

  return names
}

describe("class name modifiers", () => {
  const modifiers = modifierNames()
  const standalone = standaloneClasses()

  test("styleModifiers_areDiscovered", () => {
    expect(modifiers.size).toBeGreaterThan(5)
    expect(standalone.size).toBeGreaterThan(20)
  })

  test("styleModifiers_noneCollidesWithAStandaloneCssClass", () => {
    const collisions = [...modifiers.entries()]
      .filter(([name]) => standalone.has(name))
      .map(([name, paths]) => `${name} (used in ${[...new Set(paths)].join(", ")})`)

    expect(collisions).toEqual([])
  })
})
