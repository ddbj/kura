import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { isUsableBucketName } from "~/lib/s3/bucket-name"

// The SeaweedFS bucket name shape (docs/architecture.md 配置), redeclared here
// so a change to the implementation regex must also justify a change to the
// oracle.
const isIpV4 = (name: string): boolean => {
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name)
  if (octets === null) return false

  return octets.slice(1).every((octet) => Number(octet) <= 255 && (octet === "0" || !octet.startsWith("0")))
}

const oracle = (name: string): boolean =>
  /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)
  && name !== "filemeta"
  && !name.includes("..")
  && !name.startsWith("xn--")
  && !name.endsWith("-s3alias")
  && !isIpV4(name)

const bucketChar = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789")
const validName = fc
  .tuple(bucketChar, fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789.-"), minLength: 1, maxLength: 61 }), bucketChar)
  .map(([head, mid, tail]) => `${head}${mid}${tail}`)
  .filter(oracle)

// Mix ASCII, unicode, control characters, and shapes that stress the boundary
// checks (ipv4-shaped, xn-- prefix, -s3alias suffix, "..").
const anyName = fc.oneof(
  fc.string(),
  fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789.-_ABC") }),
  fc.tuple(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 300 })).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
  fc.string().map((s) => `xn--${s}`),
  fc.string().map((s) => `${s}-s3alias`),
  fc.string().map((s) => s.replace(/-/g, "..")),
  fc.constantFrom("filemeta", "a", "ab", "-abc", "abc-", ".abc", "abc.", "AbC"),
)

describe("isUsableBucketName properties", () => {
  test.prop([validName])("isUsableBucketName_generatedValidName_isAccepted", (name) => {
    expect(isUsableBucketName(name)).toBe(true)
  })

  // The impl and the oracle agree on every string. A shrunk counterexample
  // here is a real acceptance divergence, not a tautology about "returns a
  // boolean".
  test.prop([anyName])("isUsableBucketName_anyName_matchesOracle", (name) => {
    expect(isUsableBucketName(name)).toBe(oracle(name))
  })

  // DDBJ username 規則 (先頭は小文字英数、a-z 0-9 _ -) のうち "_" を含むものは
  // 全部 bucket 名にならない。
  test.prop([validName, fc.nat({ max: 10 })])(
    "isUsableBucketName_underscoreAnywhere_isRejected",
    (name, pos) => {
      const idx = Math.min(pos, name.length)
      expect(isUsableBucketName(`${name.slice(0, idx)}_${name.slice(idx)}`)).toBe(false)
    },
  )
})
