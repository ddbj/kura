import { http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import { createS3Client, deleteObject, ensureOwnBucket, listDirectory, presignDownloadUrl } from "~/lib/s3"

import { listObjectsV2Xml, s3ErrorXml } from "../../mocks/s3-xml"
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
})
