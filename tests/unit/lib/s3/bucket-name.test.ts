import { describe, expect, test } from "vitest"

import { isUsableBucketName } from "~/lib/s3/bucket-name"

describe("isUsableBucketName", () => {
  test.each([
    ["min length 3", "abc"],
    ["max length 63", "a".repeat(63)],
    ["digits only", "123"],
    ["dots and hyphens inside", "a.b-c"],
    ["single dots between labels", "my.bucket.name"],
    ["ip-like with octet > 255", "999.1.1.1"],
    ["ip-like with leading zero octet", "01.2.3.4"],
    ["contains but not equals filemeta", "filemeta1"],
    ["xn-- not at start", "axn--b"],
    ["s3alias not at end", "a-s3aliasx"],
  ])("isUsableBucketName_%s_isAccepted", (_label, name) => {
    expect(isUsableBucketName(name)).toBe(true)
  })

  test.each([
    ["empty", ""],
    ["too short", "ab"],
    ["too long", "a".repeat(64)],
    ["uppercase", "Abc"],
    ["underscore", "ts-kura_ddbj"],
    ["leading hyphen", "-abc"],
    ["trailing hyphen", "abc-"],
    ["leading dot", ".abc"],
    ["trailing dot", "abc."],
    ["adjacent dots", "a..b"],
    ["ipv4 address", "192.168.0.1"],
    ["xn-- prefix", "xn--abc"],
    ["-s3alias suffix", "abc-s3alias"],
    ["reserved filemeta", "filemeta"],
    ["space", "a b"],
    ["unicode lowercase", "abcä"],
  ])("isUsableBucketName_%s_isRejected", (_label, name) => {
    expect(isUsableBucketName(name)).toBe(false)
  })
})
