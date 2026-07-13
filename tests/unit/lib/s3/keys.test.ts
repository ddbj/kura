import { describe, expect, test } from "vitest"

import {
  dirName,
  encodeFilenameStrict,
  encodeStrictKey,
  entryName,
  keyToUrlPath,
  parentPrefix,
  prefixToSegments,
  prefixToUrlPath,
  segmentsToPrefix,
  splatToPrefix,
} from "~/lib/s3/keys"

describe("prefixToSegments / segmentsToPrefix", () => {
  test("prefixToSegments_bucketRoot_returnsEmpty", () => {
    expect(prefixToSegments("")).toEqual([])
  })

  test("prefixToSegments_singleSegment_stripsTrailingSlash", () => {
    expect(prefixToSegments("docs/")).toEqual(["docs"])
  })

  test("prefixToSegments_nested_splitsOnSlash", () => {
    expect(prefixToSegments("a/b/c/")).toEqual(["a", "b", "c"])
  })

  test("segmentsToPrefix_empty_returnsEmpty", () => {
    expect(segmentsToPrefix([])).toBe("")
  })

  test("segmentsToPrefix_nested_appendsTrailingSlash", () => {
    expect(segmentsToPrefix(["a", "b"])).toBe("a/b/")
  })
})

describe("parentPrefix", () => {
  test("parentPrefix_root_staysAtRoot", () => {
    expect(parentPrefix("")).toBe("")
  })

  test("parentPrefix_singleSegment_returnsRoot", () => {
    expect(parentPrefix("docs/")).toBe("")
  })

  test("parentPrefix_nested_dropsLast", () => {
    expect(parentPrefix("a/b/c/")).toBe("a/b/")
  })
})

describe("entryName / dirName", () => {
  test("entryName_returnsLastSegment", () => {
    expect(entryName("a/b/c.txt")).toBe("c.txt")
  })

  test("entryName_bucketRoot_returnsFullKey", () => {
    expect(entryName("hello.txt")).toBe("hello.txt")
  })

  test("dirName_returnsLastFolderName", () => {
    expect(dirName("a/b/c/")).toBe("c")
  })
})

describe("prefixToUrlPath / keyToUrlPath", () => {
  test("prefixToUrlPath_root_returnsEmpty", () => {
    expect(prefixToUrlPath("")).toBe("")
  })

  test("prefixToUrlPath_encodesUnicodeSegments", () => {
    expect(prefixToUrlPath("docs/読/")).toBe(`docs/${encodeURIComponent("読")}`)
  })

  test("keyToUrlPath_encodesUnicodeSegments", () => {
    expect(keyToUrlPath("docs/読/名前.txt")).toBe(
      `docs/${encodeURIComponent("読")}/${encodeURIComponent("名前.txt")}`,
    )
  })

  test("keyToUrlPath_dotSegment_isEscapedAsPercent2E", () => {
    // "." and ".." are dot segments and would be normalized away by the
    // browser or upstream proxies; force %2E so the segment survives.
    expect(keyToUrlPath("a/./b")).toBe("a/%2E/b")
    expect(keyToUrlPath("a/../b")).toBe("a/%2E%2E/b")
  })

  test("keyToUrlPath_trailingDotSegment_isEscapedAsPercent2E", () => {
    // Some proxies also normalize "abc." into "abc" (trailing-dot handling
    // borrowed from DNS labels); encode any run of trailing dots as %2E so
    // segments like "notes." survive the round trip verbatim.
    expect(keyToUrlPath("notes./file.txt")).toBe("notes%2E/file.txt")
    expect(keyToUrlPath("weird.../a")).toBe("weird%2E%2E%2E/a")
    // A dot in the middle of a segment is untouched.
    expect(keyToUrlPath("a.b/c")).toBe("a.b/c")
  })
})

describe("splatToPrefix", () => {
  test("splatToPrefix_empty_returnsRoot", () => {
    expect(splatToPrefix("")).toBe("")
  })

  test("splatToPrefix_nested_addsTrailingSlash", () => {
    expect(splatToPrefix("a/b")).toBe("a/b/")
  })
})

describe("encodeStrictKey", () => {
  test("encodeStrictKey_preservesSlashSeparators", () => {
    expect(encodeStrictKey("a/b/c")).toBe("a/b/c")
  })

  test("encodeStrictKey_percentEncodesUnicode", () => {
    expect(encodeStrictKey("docs/読み.txt")).toBe(`docs/${encodeURIComponent("読み.txt")}`)
  })

  test("encodeStrictKey_percentEncodesSubDelims", () => {
    // encodeURIComponent leaves !*'() alone. CopySource and other URL-path
    // uses need them escaped too — an unescaped "'" would collide with the
    // RFC 5987 delimiter and "()" is filtered by some proxies.
    expect(encodeStrictKey("it's (final)*.txt!")).toBe(
      "it%27s%20%28final%29%2A.txt%21",
    )
  })
})

describe("encodeFilenameStrict", () => {
  test("encodeFilenameStrict_percentEncodesSubDelims", () => {
    // Identical policy to encodeStrictKey but for a single filename token
    // (no "/" preserved — RFC 5987 filenames never contain path separators).
    const encoded = encodeFilenameStrict("it's (final)*.txt!")
    expect(encoded).not.toMatch(/['()*!]/)
    expect(encoded).toBe("it%27s%20%28final%29%2A.txt%21")
  })
})
