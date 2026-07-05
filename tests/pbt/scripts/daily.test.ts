import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { S3Client } from "@aws-sdk/client-s3"
import { afterEach, describe, expect, it, vi } from "vitest"

import { runDaily } from "../../../scripts/lib/daily.ts"

// Stubs only the S3 boundary (send); listBucketNames/sweepBucketTtl/
// cleanupBucketUploads/rotateAuditLogs run for real against it.
const stubS3Client = (
  bucketEntries: { Name?: string }[],
  failing: Set<string>,
  attempted: Set<string>,
): S3Client => {
  const send = vi.fn(async (command: { constructor: { name: string }; input: { Bucket?: string } }) => {
    if (command.constructor.name === "ListBucketsCommand") return { Buckets: bucketEntries }

    const bucket = command.input.Bucket
    if (bucket !== undefined) attempted.add(bucket)
    if (bucket !== undefined && failing.has(bucket)) {
      throw new Error(`boom: ${bucket}`)
    }
    if (command.constructor.name === "ListObjectsV2Command") return { Contents: [], IsTruncated: false }
    if (command.constructor.name === "ListMultipartUploadsCommand") return { Uploads: [], IsTruncated: false }

    return {}
  })

  return Object.assign(Object.create(S3Client.prototype), { send })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("runDaily bucket isolation", () => {
  it("buckets_oneFails_othersStillProcessedAndAuditLogsStillRotate", async () => {
    const bucketNames = ["alice", "bob", "carol"]
    const attempted = new Set<string>()
    const s3 = stubS3Client(bucketNames.map((Name) => ({ Name })), new Set(["bob"]), attempted)

    const dir = await mkdtemp(join(tmpdir(), "kura-audit-test-"))
    const oldDay = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await writeFile(join(dir, `access-${oldDay}.log`), "line\n")
    vi.stubEnv("KURA_AUDIT_LOG_DIR", dir)
    vi.stubEnv("KURA_FILE_TTL_DAYS", "")
    vi.stubEnv("KURA_MULTIPART_MAX_AGE_DAYS", "7")
    vi.stubEnv("KURA_AUDIT_RETENTION_DAYS", "1095")

    await expect(runDaily(new Date(), s3)).rejects.toThrow(/bob/)

    for (const bucket of bucketNames) {
      expect(attempted.has(bucket)).toBe(true)
    }
    await expect(readdir(dir)).resolves.toContainEqual(`access-${oldDay}.log.gz`)
  })

  it("buckets_noneFail_resolvesCleanly", async () => {
    const s3 = stubS3Client([{ Name: "dave" }], new Set(), new Set())

    vi.stubEnv("KURA_AUDIT_LOG_DIR", join(tmpdir(), "kura-audit-missing"))
    vi.stubEnv("KURA_FILE_TTL_DAYS", "")
    vi.stubEnv("KURA_MULTIPART_MAX_AGE_DAYS", "7")
    vi.stubEnv("KURA_AUDIT_RETENTION_DAYS", "1095")

    await expect(runDaily(new Date(), s3)).resolves.toBeUndefined()
  })

  it("bucketEntries_withoutName_areExcludedFromProcessing", async () => {
    const attempted = new Set<string>()
    const s3 = stubS3Client([{ Name: "dave" }, {}], new Set(), attempted)

    vi.stubEnv("KURA_AUDIT_LOG_DIR", join(tmpdir(), "kura-audit-missing"))
    vi.stubEnv("KURA_FILE_TTL_DAYS", "")
    vi.stubEnv("KURA_MULTIPART_MAX_AGE_DAYS", "7")
    vi.stubEnv("KURA_AUDIT_RETENTION_DAYS", "1095")

    await expect(runDaily(new Date(), s3)).resolves.toBeUndefined()
    expect(attempted).toEqual(new Set(["dave"]))
  })
})
