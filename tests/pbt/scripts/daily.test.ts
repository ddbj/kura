import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { S3Client } from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"

vi.mock("../../../scripts/lib/s3.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  opsS3Client: vi.fn(),
  listBucketNames: vi.fn(),
}))

const { opsS3Client, listBucketNames } = await import("../../../scripts/lib/s3.ts")
const { runDaily } = await import("../../../scripts/lib/daily.ts")

// Stubs only the S3 boundary (send); sweepBucketTtl/cleanupBucketUploads/
// rotateAuditLogs run for real against it.
const stubS3Client = (failing: Set<string>, attempted: Set<string>): S3Client => {
  const send = vi.fn(async (command: { constructor: { name: string }; input: { Bucket: string } }) => {
    attempted.add(command.input.Bucket)
    if (failing.has(command.input.Bucket)) {
      throw new Error(`boom: ${command.input.Bucket}`)
    }
    if (command.constructor.name === "ListObjectsV2Command") return { Contents: [], IsTruncated: false }
    if (command.constructor.name === "ListMultipartUploadsCommand") return { Uploads: [], IsTruncated: false }

    return {}
  })

  return { send } as unknown as S3Client
}

describe("runDaily bucket isolation", () => {
  it("buckets_oneFails_othersStillProcessedAndAuditLogsStillRotate", async () => {
    const buckets = ["alice", "bob", "carol"]
    const attempted = new Set<string>()
    vi.mocked(listBucketNames).mockResolvedValue(buckets)
    vi.mocked(opsS3Client).mockReturnValue(stubS3Client(new Set(["bob"]), attempted))

    const dir = await mkdtemp(join(tmpdir(), "kura-audit-test-"))
    const oldDay = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await writeFile(join(dir, `access-${oldDay}.log`), "line\n")
    process.env["KURA_AUDIT_LOG_DIR"] = dir
    process.env["KURA_FILE_TTL_DAYS"] = ""
    process.env["KURA_MULTIPART_MAX_AGE_DAYS"] = "7"
    process.env["KURA_AUDIT_RETENTION_DAYS"] = "1095"

    await expect(runDaily(new Date())).rejects.toThrow(/bob/)

    for (const bucket of buckets) {
      expect(attempted.has(bucket)).toBe(true)
    }
    await expect(readdir(dir)).resolves.toContainEqual(`access-${oldDay}.log.gz`)
  })

  it("buckets_noneFail_resolvesCleanly", async () => {
    const buckets = ["dave"]
    vi.mocked(listBucketNames).mockResolvedValue(buckets)
    vi.mocked(opsS3Client).mockReturnValue(stubS3Client(new Set(), new Set()))

    process.env["KURA_AUDIT_LOG_DIR"] = join(tmpdir(), "kura-audit-missing")
    process.env["KURA_FILE_TTL_DAYS"] = ""
    process.env["KURA_MULTIPART_MAX_AGE_DAYS"] = "7"
    process.env["KURA_AUDIT_RETENTION_DAYS"] = "1095"

    await expect(runDaily(new Date())).resolves.toBeUndefined()
  })
})
