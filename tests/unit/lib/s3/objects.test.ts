import { http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import {
  copyObject,
  createS3Client,
  deleteObject,
  deleteObjects,
  ensureOwnBucket,
  listAllUnderPrefix,
  listDirectory,
  presignDownloadUrl,
  renameObject,
} from "~/lib/s3"

import { copyObjectXml, deleteObjectsXml, listObjectsV2Xml, s3ErrorXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const ENDPOINT = "http://localhost:28333"
const BUCKET = "kura-tester"

const client = () =>
  createS3Client(ENDPOINT, () => Promise.resolve({
    accessKeyId: "AKIATEST",
    secretAccessKey: "secret",
    sessionToken: "session-token",
    expiration: new Date(Date.now() + 3600_000),
  }))

describe("ensureOwnBucket", () => {
  test("ensureOwnBucket_bucketExists_doesNotCreate", async () => {
    const puts: string[] = []
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}`, () => new HttpResponse(null, { status: 200 })),
      http.put(`${ENDPOINT}/${BUCKET}`, () => {
        puts.push("create")
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await ensureOwnBucket(client(), BUCKET)
    expect(puts).toEqual([])
  })

  test("ensureOwnBucket_bucketMissing_createsIt", async () => {
    const puts: string[] = []
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}`, () => new HttpResponse(null, { status: 404 })),
      http.put(`${ENDPOINT}/${BUCKET}`, () => {
        puts.push("create")
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await ensureOwnBucket(client(), BUCKET)
    expect(puts).toEqual(["create"])
  })

  test("ensureOwnBucket_headForbidden_propagates", async () => {
    server.use(http.head(`${ENDPOINT}/${BUCKET}`, () => new HttpResponse(null, { status: 403 })))
    await expect(ensureOwnBucket(client(), BUCKET)).rejects.toThrow()
  })

  test("ensureOwnBucket_createRacedByAnotherTab_treatsExistingAsSuccess", async () => {
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}`, () => new HttpResponse(null, { status: 404 })),
      http.put(`${ENDPOINT}/${BUCKET}`, () =>
        new HttpResponse(s3ErrorXml("BucketAlreadyExists", "already created by another tab"), {
          status: 409,
          headers: { "Content-Type": "application/xml" },
        })),
    )
    await expect(ensureOwnBucket(client(), BUCKET)).resolves.toBeUndefined()
  })

  test("ensureOwnBucket_createForbidden_propagates", async () => {
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}`, () => new HttpResponse(null, { status: 404 })),
      http.put(`${ENDPOINT}/${BUCKET}`, () => new HttpResponse(null, { status: 403 })),
    )
    await expect(ensureOwnBucket(client(), BUCKET)).rejects.toThrow()
  })
})

describe("listDirectory", () => {
  test("listDirectory_mapsDirsAndFiles", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get("list-type")).toBe("2")
        expect(url.searchParams.get("delimiter")).toBe("/")
        expect(url.searchParams.get("prefix")).toBe("docs/")
        return HttpResponse.xml(listObjectsV2Xml({
          bucket: BUCKET,
          prefix: "docs/",
          objects: [
            { key: "docs/読みもの & メモ.txt", size: 42, lastModified: "2026-07-01T10:00:00.000Z" },
            { key: "docs/big.bin", size: 5_000_000_000, lastModified: "2026-07-02T00:00:00.000Z" },
          ],
          commonPrefixes: ["docs/sub/", "docs/双子/"],
        }))
      }),
    )

    const page = await listDirectory(client(), BUCKET, "docs/")
    expect(page.dirs).toEqual(["docs/sub/", "docs/双子/"])
    expect(page.files).toEqual([
      { key: "docs/読みもの & メモ.txt", size: 42, lastModified: new Date("2026-07-01T10:00:00.000Z") },
      { key: "docs/big.bin", size: 5_000_000_000, lastModified: new Date("2026-07-02T00:00:00.000Z") },
    ])
    expect(page.nextToken).toBeUndefined()
  })

  test("listDirectory_excludesPrefixMarkerItself", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listObjectsV2Xml({
          bucket: BUCKET,
          prefix: "docs/",
          objects: [
            { key: "docs/", size: 0, lastModified: "2026-07-01T10:00:00.000Z" },
            { key: "docs/a.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" },
          ],
          commonPrefixes: [],
        }))),
    )
    const page = await listDirectory(client(), BUCKET, "docs/")
    expect(page.files.map((f) => f.key)).toEqual(["docs/a.txt"])
  })

  test("listDirectory_truncated_returnsNextToken", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listObjectsV2Xml({
          bucket: BUCKET,
          prefix: "",
          objects: [{ key: "a.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" }],
          commonPrefixes: [],
          nextContinuationToken: "token-123",
        }))),
    )
    const page = await listDirectory(client(), BUCKET, "")
    expect(page.nextToken).toBe("token-123")
  })

  test("listDirectory_continuationTokenIsSent", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("continuation-token")).toBe("token-123")
        return HttpResponse.xml(listObjectsV2Xml({ bucket: BUCKET, prefix: "", objects: [], commonPrefixes: [] }))
      }),
    )
    await listDirectory(client(), BUCKET, "", "token-123")
  })

  test("listDirectory_serverError_propagates", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        new HttpResponse(s3ErrorXml("InternalError", "boom"), { status: 500, headers: { "Content-Type": "application/xml" } })),
    )
    await expect(listDirectory(client(), BUCKET, "")).rejects.toThrow()
  })
})

describe("deleteObject", () => {
  test("deleteObject_issuesDelete", async () => {
    const deleted: string[] = []
    server.use(
      http.delete(`${ENDPOINT}/${BUCKET}/:key+`, ({ params }) => {
        const key = params["key"]
        deleted.push(Array.isArray(key) ? key.join("/") : String(key))
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await deleteObject(client(), BUCKET, "docs/old.txt")
    expect(deleted).toEqual(["docs/old.txt"])
  })
})

describe("copyObject", () => {
  test("copyObject_sendsCopySourceHeaderAndTaggingCopy", async () => {
    let copySource: string | null = null
    let taggingDirective: string | null = null
    let metadataDirective: string | null = null
    server.use(
      http.put(`${ENDPOINT}/${BUCKET}/:key+`, ({ request }) => {
        copySource = request.headers.get("x-amz-copy-source")
        taggingDirective = request.headers.get("x-amz-tagging-directive")
        metadataDirective = request.headers.get("x-amz-metadata-directive")
        return HttpResponse.xml(copyObjectXml("etag", "2026-07-13T00:00:00.000Z"))
      }),
    )
    await copyObject(client(), BUCKET, "docs/old.txt", "docs/new.txt")
    expect(copySource).toBe(`${BUCKET}/docs/old.txt`)
    expect(taggingDirective).toBe("COPY")
    expect(metadataDirective).toBe("COPY")
  })

  test("copyObject_encodesNonAsciiKey", async () => {
    let copySource: string | null = null
    server.use(
      http.put(`${ENDPOINT}/${BUCKET}/:key+`, ({ request }) => {
        copySource = request.headers.get("x-amz-copy-source")
        return HttpResponse.xml(copyObjectXml("etag", "2026-07-13T00:00:00.000Z"))
      }),
    )
    await copyObject(client(), BUCKET, "docs/読みもの.txt", "docs/新.txt")
    // percent-encoded, "/" preserved
    expect(copySource).toBe(`${BUCKET}/docs/${encodeURIComponent("読みもの.txt")}`)
  })

  test("copyObject_serverError_propagates", async () => {
    server.use(
      http.put(`${ENDPOINT}/${BUCKET}/:key+`, () =>
        new HttpResponse(s3ErrorXml("AccessDenied", "no"), { status: 403, headers: { "Content-Type": "application/xml" } })),
    )
    await expect(copyObject(client(), BUCKET, "a", "b")).rejects.toThrow()
  })
})

describe("deleteObjects", () => {
  test("deleteObjects_batchesUpTo1000AndAggregates", async () => {
    let batchCount = 0
    server.use(
      http.post(`${ENDPOINT}/${BUCKET}`, ({ request }) => {
        const url = new URL(request.url)
        if (!url.searchParams.has("delete")) return new HttpResponse(null, { status: 400 })
        batchCount += 1
        const start = (batchCount - 1) * 1000
        const end = Math.min(start + 1000, 1500)
        const deleted = Array.from({ length: end - start }, (_, i) => `k${start + i}`)
        return HttpResponse.xml(deleteObjectsXml({ deleted }))
      }),
    )
    const keys = Array.from({ length: 1500 }, (_, i) => `k${i}`)
    const res = await deleteObjects(client(), BUCKET, keys)
    expect(batchCount).toBe(2)
    expect(res.deleted.length).toBe(1500)
    expect(res.failed).toEqual([])
  })

  test("deleteObjects_reportsPerKeyErrors", async () => {
    server.use(
      http.post(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(deleteObjectsXml({
          deleted: ["a"],
          errors: [{ key: "b", code: "AccessDenied", message: "nope" }],
        }))),
    )
    const res = await deleteObjects(client(), BUCKET, ["a", "b"])
    expect(res.deleted).toEqual(["a"])
    expect(res.failed).toEqual([{ key: "b", message: "nope" }])
  })

  test("deleteObjects_emptyKeys_isNoop", async () => {
    let hit = 0
    server.use(
      http.post(`${ENDPOINT}/${BUCKET}`, () => { hit += 1; return HttpResponse.xml(deleteObjectsXml({ deleted: [] })) }),
    )
    const res = await deleteObjects(client(), BUCKET, [])
    expect(hit).toBe(0)
    expect(res).toEqual({ deleted: [], failed: [] })
  })
})

describe("renameObject", () => {
  test("renameObject_copiesThenDeletesSource", async () => {
    const events: string[] = []
    server.use(
      http.put(`${ENDPOINT}/${BUCKET}/new.txt`, () => {
        events.push("copy")
        return HttpResponse.xml(copyObjectXml("etag", "2026-07-13T00:00:00.000Z"))
      }),
      http.delete(`${ENDPOINT}/${BUCKET}/old.txt`, () => {
        events.push("delete")
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await renameObject(client(), BUCKET, "old.txt", "new.txt")
    expect(events).toEqual(["copy", "delete"])
  })

  test("renameObject_copyFails_skipsDelete", async () => {
    let deleteHit = 0
    server.use(
      http.put(`${ENDPOINT}/${BUCKET}/new.txt`, () =>
        new HttpResponse(s3ErrorXml("AccessDenied", "no"), { status: 403, headers: { "Content-Type": "application/xml" } })),
      http.delete(`${ENDPOINT}/${BUCKET}/old.txt`, () => { deleteHit += 1; return new HttpResponse(null, { status: 204 }) }),
    )
    await expect(renameObject(client(), BUCKET, "old.txt", "new.txt")).rejects.toThrow()
    expect(deleteHit).toBe(0)
  })

  test("renameObject_sameKey_isNoop", async () => {
    let hit = 0
    server.use(
      http.put(`${ENDPOINT}/${BUCKET}/:key+`, () => { hit += 1; return HttpResponse.xml(copyObjectXml("etag", "2026-07-13T00:00:00.000Z")) }),
      http.delete(`${ENDPOINT}/${BUCKET}/:key+`, () => { hit += 1; return new HttpResponse(null, { status: 204 }) }),
    )
    await renameObject(client(), BUCKET, "same.txt", "same.txt")
    expect(hit).toBe(0)
  })
})

describe("listAllUnderPrefix", () => {
  test("listAllUnderPrefix_paginatesUntilExhausted", async () => {
    const seenTokens: (string | null)[] = []
    const seenDelimiters: (string | null)[] = []
    let call = 0
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, ({ request }) => {
        const url = new URL(request.url)
        seenDelimiters.push(url.searchParams.get("delimiter"))
        seenTokens.push(url.searchParams.get("continuation-token"))
        call += 1
        return HttpResponse.xml(listObjectsV2Xml({
          bucket: BUCKET,
          prefix: "docs/",
          objects: call === 1
            ? [{ key: "docs/a.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" }]
            : [{ key: "docs/b.txt", size: 2, lastModified: "2026-07-01T10:00:00.000Z" }],
          commonPrefixes: [],
          ...(call === 1 ? { nextContinuationToken: "next" } : {}),
        }))
      }),
    )
    const entries = await listAllUnderPrefix(client(), BUCKET, "docs/")
    expect(entries).toEqual([{ key: "docs/a.txt", size: 1 }, { key: "docs/b.txt", size: 2 }])
    expect(seenDelimiters).toEqual([null, null])
    expect(seenTokens).toEqual([null, "next"])
  })

  test("listAllUnderPrefix_includesKeepMarker", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listObjectsV2Xml({
          bucket: BUCKET,
          prefix: "docs/",
          objects: [
            { key: "docs/.keep", size: 0, lastModified: "2026-07-01T10:00:00.000Z" },
            { key: "docs/a.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" },
          ],
          commonPrefixes: [],
        }))),
    )
    const entries = await listAllUnderPrefix(client(), BUCKET, "docs/")
    expect(entries.map((e) => e.key)).toEqual(["docs/.keep", "docs/a.txt"])
  })
})

describe("presignDownloadUrl", () => {
  test("presignDownloadUrl_containsSignatureTokenAndDisposition", async () => {
    const url = new URL(await presignDownloadUrl(client(), BUCKET, "docs/読みもの.txt"))
    expect(url.origin).toBe(ENDPOINT)
    expect(decodeURIComponent(url.pathname)).toBe(`/${BUCKET}/docs/読みもの.txt`)
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy()
    expect(url.searchParams.get("X-Amz-Security-Token")).toBe("session-token")
    expect(url.searchParams.get("response-content-disposition")).toContain("attachment")
    expect(url.searchParams.get("response-content-disposition")).toContain(encodeURIComponent("読みもの.txt"))
  })

  test("presignDownloadUrl_filenameWithQuote_escapesRfc5987DelimiterChars", async () => {
    const url = new URL(await presignDownloadUrl(client(), BUCKET, "docs/it's (final)*.txt"))
    const disposition = url.searchParams.get("response-content-disposition") ?? ""
    expect(disposition).toContain("filename*=UTF-8''")
    const encodedName = disposition.slice(disposition.indexOf("UTF-8''") + "UTF-8''".length)
    expect(encodedName).not.toMatch(/['()*!]/)
  })
})
