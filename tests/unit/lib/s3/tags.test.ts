import { http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import { getObjectIsPublic, publishObject, unpublishObject } from "~/lib/s3/tags"

import { TEST_S3_ENDPOINT as ENDPOINT,testS3 } from "../../_helpers/s3"
import { getObjectTaggingXml, s3ErrorXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

describe("getObjectIsPublic", () => {
  test("getObjectIsPublic_kuraPublicTrue_returnsTrue", async () => {
    server.use(http.get(`${ENDPOINT}/kura-tester/docs/a.txt`, ({ request }) => {
      expect(new URL(request.url).searchParams.has("tagging")).toBe(true)
      return HttpResponse.xml(getObjectTaggingXml([{ key: "kura-public", value: "true" }]))
    }))

    await expect(getObjectIsPublic(testS3(), "kura-tester", "docs/a.txt")).resolves.toBe(true)
  })

  test("getObjectIsPublic_noTags_returnsFalse", async () => {
    server.use(http.get(`${ENDPOINT}/kura-tester/docs/a.txt`, () =>
      HttpResponse.xml(getObjectTaggingXml([]))))

    await expect(getObjectIsPublic(testS3(), "kura-tester", "docs/a.txt")).resolves.toBe(false)
  })

  test("getObjectIsPublic_s3Error_propagates", async () => {
    server.use(http.get(`${ENDPOINT}/kura-tester/docs/a.txt`, () =>
      new HttpResponse(s3ErrorXml("AccessDenied", "denied"), {
        status: 403,
        headers: { "Content-Type": "application/xml" },
      })))

    await expect(getObjectIsPublic(testS3(), "kura-tester", "docs/a.txt")).rejects.toThrow()
  })
})

// Parses a PutObjectTagging XML body into a bare list of [key, value] pairs
// so tests can assert on tag set contents regardless of element order.
const parseTagBodyPairs = (body: string): [string, string][] => {
  const pairs: [string, string][] = []
  const re = /<Tag>\s*<Key>([\s\S]*?)<\/Key>\s*<Value>([\s\S]*?)<\/Value>\s*<\/Tag>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    pairs.push([m[1] ?? "", m[2] ?? ""])
  }

  return pairs
}

describe("publishObject / unpublishObject", () => {
  test("publishObject_putsKuraPublicTrueTagging", async () => {
    const seen: { url: string; body: string }[] = []
    server.use(
      http.get(`${ENDPOINT}/kura-tester/docs/a.txt`, () =>
        HttpResponse.xml(getObjectTaggingXml([]))),
      http.put(`${ENDPOINT}/kura-tester/docs/a.txt`, async ({ request }) => {
        seen.push({ url: request.url, body: await request.text() })
        return new HttpResponse(null, { status: 200 })
      }),
    )

    await publishObject(testS3(), "kura-tester", "docs/a.txt")
    expect(seen).toHaveLength(1)
    expect(new URL(seen[0]!.url).searchParams.has("tagging")).toBe(true)
    expect(parseTagBodyPairs(seen[0]!.body)).toEqual([["kura-public", "true"]])
  })

  test("publishObject_preservesUnrelatedTags", async () => {
    // A CLI user (or another tool) may have set unrelated tags. Overwriting
    // the whole set on publish would silently drop those; instead we read,
    // add / update kura-public, and write the merged set back.
    const seen: string[] = []
    server.use(
      http.get(`${ENDPOINT}/kura-tester/docs/a.txt`, () =>
        HttpResponse.xml(getObjectTaggingXml([
          { key: "team", value: "sator" },
          { key: "owner", value: "alice" },
        ]))),
      http.put(`${ENDPOINT}/kura-tester/docs/a.txt`, async ({ request }) => {
        seen.push(await request.text())
        return new HttpResponse(null, { status: 200 })
      }),
    )

    await publishObject(testS3(), "kura-tester", "docs/a.txt")
    expect(seen).toHaveLength(1)
    const pairs = parseTagBodyPairs(seen[0]!)
    // Order is not part of the S3 contract; assert as a set.
    expect(new Set(pairs.map(([k, v]) => `${k}=${v}`))).toEqual(new Set([
      "team=sator",
      "owner=alice",
      "kura-public=true",
    ]))
  })

  test("publishObject_replacesExistingPublicValue", async () => {
    // A pre-existing kura-public tag with a stray value must end up as
    // kura-public=true, not duplicated in the tag set.
    const seen: string[] = []
    server.use(
      http.get(`${ENDPOINT}/kura-tester/docs/a.txt`, () =>
        HttpResponse.xml(getObjectTaggingXml([
          { key: "kura-public", value: "yes" },
        ]))),
      http.put(`${ENDPOINT}/kura-tester/docs/a.txt`, async ({ request }) => {
        seen.push(await request.text())
        return new HttpResponse(null, { status: 200 })
      }),
    )

    await publishObject(testS3(), "kura-tester", "docs/a.txt")
    expect(parseTagBodyPairs(seen[0]!)).toEqual([["kura-public", "true"]])
  })

  test("unpublishObject_deletesTaggingWhenNothingElseWasSet", async () => {
    // No other tags -> DeleteObjectTagging clears the set atomically (an
    // empty PutObjectTagging is rejected by S3).
    const gets: string[] = []
    const deletes: string[] = []
    server.use(
      http.get(`${ENDPOINT}/kura-tester/docs/a.txt`, ({ request }) => {
        gets.push(request.url)
        return HttpResponse.xml(getObjectTaggingXml([
          { key: "kura-public", value: "true" },
        ]))
      }),
      http.delete(`${ENDPOINT}/kura-tester/docs/a.txt`, ({ request }) => {
        deletes.push(request.url)
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await unpublishObject(testS3(), "kura-tester", "docs/a.txt")
    expect(gets).toHaveLength(1)
    expect(deletes).toHaveLength(1)
    expect(new URL(deletes[0]!).searchParams.has("tagging")).toBe(true)
  })

  test("unpublishObject_preservesUnrelatedTags", async () => {
    // Other tags survive: only kura-public is dropped, the rest are written
    // back as the object's tag set.
    const puts: string[] = []
    let deleteCalls = 0
    server.use(
      http.get(`${ENDPOINT}/kura-tester/docs/a.txt`, () =>
        HttpResponse.xml(getObjectTaggingXml([
          { key: "team", value: "sator" },
          { key: "kura-public", value: "true" },
          { key: "owner", value: "alice" },
        ]))),
      http.put(`${ENDPOINT}/kura-tester/docs/a.txt`, async ({ request }) => {
        puts.push(await request.text())
        return new HttpResponse(null, { status: 200 })
      }),
      http.delete(`${ENDPOINT}/kura-tester/docs/a.txt`, () => {
        deleteCalls += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await unpublishObject(testS3(), "kura-tester", "docs/a.txt")
    expect(puts).toHaveLength(1)
    expect(deleteCalls).toBe(0)
    const pairs = parseTagBodyPairs(puts[0]!)
    expect(new Set(pairs.map(([k, v]) => `${k}=${v}`))).toEqual(new Set([
      "team=sator",
      "owner=alice",
    ]))
  })
})
