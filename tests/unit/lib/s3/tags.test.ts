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

describe("publishObject / unpublishObject", () => {
  test("publishObject_putsKuraPublicTrueTagging", async () => {
    const seen: { url: string; body: string }[] = []
    server.use(http.put(`${ENDPOINT}/kura-tester/docs/a.txt`, async ({ request }) => {
      seen.push({ url: request.url, body: await request.text() })
      return new HttpResponse(null, { status: 200 })
    }))

    await publishObject(testS3(), "kura-tester", "docs/a.txt")
    expect(seen).toHaveLength(1)
    expect(new URL(seen[0]!.url).searchParams.has("tagging")).toBe(true)
    expect(seen[0]!.body).toContain("<Key>kura-public</Key>")
    expect(seen[0]!.body).toContain("<Value>true</Value>")
  })

  test("unpublishObject_deletesTagging", async () => {
    const seen: string[] = []
    server.use(http.delete(`${ENDPOINT}/kura-tester/docs/a.txt`, ({ request }) => {
      seen.push(request.url)
      return new HttpResponse(null, { status: 204 })
    }))

    await unpublishObject(testS3(), "kura-tester", "docs/a.txt")
    expect(seen).toHaveLength(1)
    expect(new URL(seen[0]!).searchParams.has("tagging")).toBe(true)
  })
})
