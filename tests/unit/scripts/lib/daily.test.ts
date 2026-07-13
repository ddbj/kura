import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { S3Client } from "@aws-sdk/client-s3"
import { http, HttpResponse } from "msw"
import { afterEach, describe, expect, it, vi } from "vitest"

import { runDaily } from "../../../../scripts/lib/daily.ts"
import { deleteObjectsXml, listBucketsXml, listMultipartUploadsXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const ENDPOINT = "http://localhost:28333"

const opsClient = (): S3Client =>
  new S3Client({
    endpoint: ENDPOINT,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "root", secretAccessKey: "root-secret" },
  })

const DAY_MS = 24 * 60 * 60 * 1000

// Registers ListBuckets + the per-bucket ListMultipartUploads / DeleteObjects
// handlers runDaily hits when KURA_FILE_TTL_DAYS is empty (no TTL sweep). A
// bucket whose name is in `fail500` responds 500 to the first bucket-scoped
// request, tracked in `attempted`.
const seedS3 = ({ buckets, fail500 = new Set<string>() }: {
  buckets: readonly { name: string }[]
  fail500?: Set<string>
}) => {
  const attempted = new Set<string>()
  server.use(
    http.get(`${ENDPOINT}/`, () => HttpResponse.xml(listBucketsXml(buckets))),
    ...buckets.map(({ name }) =>
      http.get(`${ENDPOINT}/${name}`, ({ request }) => {
        attempted.add(name)
        if (fail500.has(name)) {
          return new HttpResponse("boom", { status: 500 })
        }
        const url = new URL(request.url)
        if (url.searchParams.has("uploads")) {
          return HttpResponse.xml(listMultipartUploadsXml({ bucket: name, uploads: [] }))
        }
        return HttpResponse.xml(deleteObjectsXml({ deleted: [] }))
      })),
  )
  return { attempted }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("runDaily bucket isolation", () => {
  it("buckets_oneFails_othersStillProcessedAndAuditLogsStillRotate", async () => {
    const buckets = [{ name: "alice" }, { name: "bob" }, { name: "carol" }]
    const { attempted } = seedS3({ buckets, fail500: new Set(["bob"]) })

    const dir = await mkdtemp(join(tmpdir(), "kura-audit-test-"))
    const oldDay = new Date(Date.now() - 8 * DAY_MS).toISOString().slice(0, 10)
    await writeFile(join(dir, `access-${oldDay}.log`), "line\n")
    vi.stubEnv("KURA_LOG_DIR", dir)
    vi.stubEnv("KURA_FILE_TTL_DAYS", "")
    vi.stubEnv("KURA_MULTIPART_MAX_AGE_DAYS", "7")
    vi.stubEnv("KURA_AUDIT_RETENTION_DAYS", "1095")

    await expect(runDaily(new Date(), opsClient())).rejects.toThrow(/bob/)

    for (const b of buckets) {
      expect(attempted.has(b.name)).toBe(true)
    }
    // Audit rotation runs even though one bucket errored.
    await expect(readdir(dir)).resolves.toContainEqual(`access-${oldDay}.log.gz`)
  })

  it("buckets_noneFail_resolvesCleanly", async () => {
    seedS3({ buckets: [{ name: "dave" }] })

    vi.stubEnv("KURA_LOG_DIR", join(tmpdir(), "kura-audit-missing"))
    vi.stubEnv("KURA_FILE_TTL_DAYS", "")
    vi.stubEnv("KURA_MULTIPART_MAX_AGE_DAYS", "7")
    vi.stubEnv("KURA_AUDIT_RETENTION_DAYS", "1095")

    await expect(runDaily(new Date(), opsClient())).resolves.toBeUndefined()
  })

  it("bucketEntries_withoutName_areExcludedFromProcessing", async () => {
    // ListBuckets can include entries whose <Name> is missing (empty tag);
    // listBucketNames drops them, so no per-bucket request must fire.
    let bareBucketHits = 0
    server.use(
      http.get(`${ENDPOINT}/`, () => HttpResponse.xml(`<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner><ID>test</ID><DisplayName>test</DisplayName></Owner>
  <Buckets>
    <Bucket><Name>dave</Name><CreationDate>2026-07-01T00:00:00.000Z</CreationDate></Bucket>
    <Bucket><CreationDate>2026-07-01T00:00:00.000Z</CreationDate></Bucket>
  </Buckets>
</ListAllMyBucketsResult>`)),
      http.get(`${ENDPOINT}/dave`, ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.has("uploads")) {
          return HttpResponse.xml(listMultipartUploadsXml({ bucket: "dave", uploads: [] }))
        }
        return HttpResponse.xml(deleteObjectsXml({ deleted: [] }))
      }),
      // If listBucketNames leaked the nameless entry, a request to a
      // bucket-less URL segment (i.e. any other host+path) would happen; msw
      // errors on unhandled — but we assert positively too by watching for a
      // literal empty path.
      http.get(`${ENDPOINT}//`, () => { bareBucketHits += 1; return new HttpResponse(null, { status: 400 }) }),
    )

    vi.stubEnv("KURA_LOG_DIR", join(tmpdir(), "kura-audit-missing"))
    vi.stubEnv("KURA_FILE_TTL_DAYS", "")
    vi.stubEnv("KURA_MULTIPART_MAX_AGE_DAYS", "7")
    vi.stubEnv("KURA_AUDIT_RETENTION_DAYS", "1095")

    await expect(runDaily(new Date(), opsClient())).resolves.toBeUndefined()
    expect(bareBucketHits).toBe(0)
  })
})
