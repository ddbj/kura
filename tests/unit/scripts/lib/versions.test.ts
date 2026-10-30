import { S3Client } from "@aws-sdk/client-s3"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"

import { purgeOldVersions } from "../../../../scripts/lib/versions.ts"
import { bucketVersioningXml, deleteObjectsXml, listObjectVersionsXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const ENDPOINT = "http://localhost:28333"
const BUCKET = "alice"

const opsClient = (): S3Client =>
  new S3Client({
    endpoint: ENDPOINT,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "root", secretAccessKey: "root-secret" },
  })

type Page = Parameters<typeof listObjectVersionsXml>[0]

// Answers GetBucketVersioning with `status`, ListObjectVersions with `pages`
// in order (the last page repeats), and DeleteObjects with `deleteResult`.
// Records the markers each listing asked for and the version ids of each
// DeleteObjects batch.
const seedBucket = ({ status, pages = [], deleteResult = () => deleteObjectsXml({ deleted: [] }) }: {
  status?: "Enabled" | "Suspended"
  pages?: readonly Page[]
  deleteResult?: (batch: string[]) => string
}) => {
  const listings: { keyMarker: string | null; versionIdMarker: string | null }[] = []
  const batches: string[][] = []
  server.use(
    http.get(`${ENDPOINT}/${BUCKET}`, ({ request }) => {
      const url = new URL(request.url)
      if (url.searchParams.has("versioning")) return HttpResponse.xml(bucketVersioningXml(status))
      if (url.searchParams.has("versions")) {
        const page = pages[Math.min(listings.length, pages.length - 1)]
        listings.push({ keyMarker: url.searchParams.get("key-marker"), versionIdMarker: url.searchParams.get("version-id-marker") })
        return HttpResponse.xml(listObjectVersionsXml(page ?? { bucket: BUCKET, versions: [] }))
      }
      return new HttpResponse("unexpected", { status: 400 })
    }),
    http.post(`${ENDPOINT}/${BUCKET}`, async ({ request }) => {
      const body = await request.text()
      const batch = [...body.matchAll(/<VersionId>([^<]*)<\/VersionId>/g)].map((m) => m[1] as string)
      batches.push(batch)
      return HttpResponse.xml(deleteResult(batch))
    }),
  )
  return { listings, batches }
}

const version = (key: string, versionId: string, isLatest = false) => ({ key, versionId, isLatest })

describe("purgeOldVersions", () => {
  it("bucket_versioningNeverEnabled_listsAndDeletesNothing", async () => {
    const { listings, batches } = seedBucket({})

    await expect(purgeOldVersions(opsClient(), BUCKET)).resolves.toEqual({ versioned: false })
    expect(listings).toHaveLength(0)
    expect(batches).toHaveLength(0)
  })

  it("bucket_versioningEnabled_keepsLatestAndDeletesOldVersionsBeforeMarkers", async () => {
    const { batches } = seedBucket({
      status: "Enabled",
      pages: [{
        bucket: BUCKET,
        versions: [version("a.txt", "a2", true), version("a.txt", "a1"), version("b.txt", "b1")],
        deleteMarkers: [version("b.txt", "bm", true)],
      }],
    })

    await expect(purgeOldVersions(opsClient(), BUCKET)).resolves.toEqual({ versioned: true, deleted: 3, failed: 0 })
    expect(batches).toEqual([["a1", "b1"], ["bm"]])
  })

  it("bucket_versioningSuspended_isPurgedToo", async () => {
    const { batches } = seedBucket({
      status: "Suspended",
      pages: [{ bucket: BUCKET, versions: [version("a.txt", "a2", true), version("a.txt", "a1")] }],
    })

    await expect(purgeOldVersions(opsClient(), BUCKET)).resolves.toEqual({ versioned: true, deleted: 1, failed: 0 })
    expect(batches).toEqual([["a1"]])
  })

  it("bucket_onlyLatestVersions_sendsNoDelete", async () => {
    const { batches } = seedBucket({
      status: "Enabled",
      pages: [{ bucket: BUCKET, versions: [version("a.txt", "a1", true), version(".keep", "k1", true)] }],
    })

    await expect(purgeOldVersions(opsClient(), BUCKET)).resolves.toEqual({ versioned: true, deleted: 0, failed: 0 })
    expect(batches).toHaveLength(0)
  })

  // A marker removed over a version that is still there would bring the
  // deleted file back into the owner's listing.
  it("versionDelete_fails_leavesDeleteMarkersInPlace", async () => {
    const { batches } = seedBucket({
      status: "Enabled",
      pages: [{
        bucket: BUCKET,
        versions: [version("b.txt", "b1")],
        deleteMarkers: [version("b.txt", "bm", true)],
      }],
      deleteResult: () => `<?xml version="1.0" encoding="UTF-8"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Error><Key>b.txt</Key><VersionId>b1</VersionId><Code>InternalError</Code><Message>boom</Message></Error>
</DeleteResult>`,
    })

    await expect(purgeOldVersions(opsClient(), BUCKET)).resolves.toEqual({ versioned: true, deleted: 0, failed: 1 })
    expect(batches).toEqual([["b1"]])
  })

  it("listing_spansPages_followsBothMarkers", async () => {
    const { listings, batches } = seedBucket({
      status: "Enabled",
      pages: [
        { bucket: BUCKET, versions: [version("a.txt", "a1")], nextKeyMarker: "a.txt", nextVersionIdMarker: "a1" },
        { bucket: BUCKET, versions: [version("b.txt", "b1")] },
      ],
    })

    await purgeOldVersions(opsClient(), BUCKET)
    expect(listings).toEqual([
      { keyMarker: null, versionIdMarker: null },
      { keyMarker: "a.txt", versionIdMarker: "a1" },
    ])
    expect(batches).toEqual([["a1", "b1"]])
  })

  it("listing_truncatedWithoutMarker_stopsAfterOnePage", async () => {
    const { listings } = seedBucket({
      status: "Enabled",
      pages: [{ bucket: BUCKET, versions: [version("a.txt", "a1")], truncatedNoMarker: true }],
    })

    await purgeOldVersions(opsClient(), BUCKET)
    expect(listings).toHaveLength(1)
  })

  it("listing_markerDoesNotMove_throwsInsteadOfLooping", async () => {
    seedBucket({
      status: "Enabled",
      pages: [{ bucket: BUCKET, versions: [version("a.txt", "a1")], nextKeyMarker: "a.txt", nextVersionIdMarker: "a1" }],
    })

    await expect(purgeOldVersions(opsClient(), BUCKET)).rejects.toThrow(/same marker/)
  })

  it("oldVersions_over1000_areDeletedInBatchesOf1000", async () => {
    const versions = Array.from({ length: 2001 }, (_, i) => version("big.bin", `v${i}`))
    const { batches } = seedBucket({ status: "Enabled", pages: [{ bucket: BUCKET, versions }] })

    await expect(purgeOldVersions(opsClient(), BUCKET)).resolves.toEqual({ versioned: true, deleted: 2001, failed: 0 })
    expect(batches.map((batch) => batch.length)).toEqual([1000, 1000, 1])
  })
})
