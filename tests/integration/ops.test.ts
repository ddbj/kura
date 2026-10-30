import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { describe, expect, inject, it } from "vitest"

import { assumeRole, eventually, putText, rootS3Client, s3ClientFor, setupUser, signToken, uniqueUser, weedShell } from "./_helpers"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DAY_MS = 24 * 60 * 60 * 1000

const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString()

// Runs one ops pass exactly as the ops container does, against the test stack.
const runOpsDaily = (nowIso: string, extraEnv: Record<string, string> = {}) =>
  execFileSync("node", ["scripts/ops-daily.ts", `--now=${nowIso}`], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      KURA_S3_ENDPOINT: inject("s3Endpoint"),
      KURA_ROOT_ACCESS_KEY: inject("rootAccessKey"),
      KURA_ROOT_SECRET_KEY: inject("rootSecretKey"),
      KURA_FILE_TTL_DAYS: "30",
      ...extraEnv,
    },
  })

// The value the long-running ops container was actually started with. The
// cleanup test below runs against this rather than the code default, so the
// two cannot drift apart unnoticed.
const deployedMultipartMaxAgeDays = (): string =>
  execFileSync("docker", ["exec", "kura-test-ops-1", "printenv", "KURA_MULTIPART_MAX_AGE_DAYS"], {
    encoding: "utf8",
  }).trim()

describe("ops service env passthrough", () => {
  it("forwards the operator-tunable retention env var into the ops container", () => {
    expect(deployedMultipartMaxAgeDays()).toBe("3")
  })
})

describe("default quota reconciler", () => {
  it("applies the default quota to buckets without one", async () => {
    const { username } = await setupUser()

    // env.test: KURA_OPS_INTERVAL_SECONDS=5, KURA_QUOTA_DEFAULT_MB=1024
    await eventually(async () => {
      const listed = weedShell("s3.bucket.list")
      const line = listed.split("\n").find((l) => l.includes(username))
      expect(line).toContain("quota:1073741824")
    }, 60_000, 2_000)
  })
})

describe("file TTL sweep", () => {
  it("deletes only objects past the TTL", async () => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "a/keep me.txt", "k")
    await putText(s3, username, "b/nested/expire.txt", "e")

    runOpsDaily(daysFromNow(29))
    const kept = await s3.send(new ListObjectsV2Command({ Bucket: username }))
    expect(kept.Contents?.length).toBe(2)

    runOpsDaily(daysFromNow(31))
    const swept = await s3.send(new ListObjectsV2Command({ Bucket: username }))
    expect(swept.Contents ?? []).toHaveLength(0)
  })

  // The marker is the only thing keeping an empty folder listable, and it is
  // created once and never touched again — so its own age must not delete it.
  it("keeps empty-folder markers regardless of their age", async () => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "empty/.keep", "")
    await putText(s3, username, ".keep", "")
    await putText(s3, username, "empty/data.txt", "d")

    runOpsDaily(daysFromNow(31))

    const remaining = await s3.send(new ListObjectsV2Command({ Bucket: username }))
    expect((remaining.Contents ?? []).map((o) => o.Key).sort()).toEqual([".keep", "empty/.keep"])
  })

  it("leaves everything alone when the TTL is disabled", async () => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "forever.txt", "f")

    runOpsDaily(daysFromNow(10_000), { KURA_FILE_TTL_DAYS: "" })
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: username }))
    expect(listed.Contents?.length).toBe(1)
  })
})

// A user who creates their bucket with Object Lock gets versioning, which kura
// does not offer: what they delete or overwrite stays behind, out of their
// reach and counted against their quota.
describe("old versions in a bucket created with Object Lock", () => {
  const setupObjectLockUser = async () => {
    const username = uniqueUser()
    const s3 = s3ClientFor(await assumeRole(await signToken({ username })))
    await s3.send(new CreateBucketCommand({ Bucket: username, ObjectLockEnabledForBucket: true }))

    return { username, s3 }
  }

  const listVersions = async (bucket: string) => {
    const res = await rootS3Client().send(new ListObjectVersionsCommand({ Bucket: bucket }))

    return {
      versions: (res.Versions ?? []).map((v) => `${v.Key ?? "?"}:${v.IsLatest === true ? "latest" : "old"}`).sort(),
      deleteMarkers: (res.DeleteMarkers ?? []).length,
    }
  }

  it("turns versioning on, which the cleanup relies on to find the bucket", async () => {
    const { username } = await setupObjectLockUser()
    const res = await rootS3Client().send(new GetBucketVersioningCommand({ Bucket: username }))
    expect(res.Status).toBe("Enabled")
  })

  it("deletes old versions and delete markers, keeps the files the owner sees", async () => {
    const { username, s3 } = await setupObjectLockUser()
    await putText(s3, username, "a.txt", "one")
    await putText(s3, username, "a.txt", "two")
    await putText(s3, username, "b.txt", "gone")
    await s3.send(new DeleteObjectCommand({ Bucket: username, Key: "b.txt" }))
    await putText(s3, username, "empty/.keep", "")

    // The ops container of the test stack runs the same pass every few
    // seconds, so the state before this run is not asserted: either pass may
    // be the one that cleans up.
    const out = runOpsDaily(daysFromNow(0), { KURA_FILE_TTL_DAYS: "" })

    expect(await listVersions(username)).toEqual({ versions: ["a.txt:latest", "empty/.keep:latest"], deleteMarkers: 0 })
    expect(out).toContain(`bucket ${username} has versioning on`)
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: username }))
    expect((listed.Contents ?? []).map((o) => o.Key).sort()).toEqual(["a.txt", "empty/.keep"])
  })

  // The TTL sweep only lays delete markers over expired files in such a
  // bucket; the same pass has to take the content away too.
  it("leaves nothing of a file past the TTL", async () => {
    const { username, s3 } = await setupObjectLockUser()
    await putText(s3, username, "old.txt", "x")

    runOpsDaily(daysFromNow(31))

    expect(await listVersions(username)).toEqual({ versions: [], deleteMarkers: 0 })
  })

  it("leaves a bucket without versioning out of the report", async () => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "plain.txt", "p")

    const out = runOpsDaily(daysFromNow(0), { KURA_FILE_TTL_DAYS: "" })

    expect(out).not.toContain(`bucket ${username} has versioning on`)
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: username }))
    expect(listed.Contents?.length).toBe(1)
  })
})

describe("stale multipart cleanup", () => {
  it("aborts uploads idle past the age limit, keeps recent and part-less ones", async () => {
    const { username, s3 } = await setupUser()
    const withParts = await s3.send(
      new CreateMultipartUploadCommand({ Bucket: username, Key: "stale.bin" }),
    )
    await s3.send(
      new UploadPartCommand({
        Bucket: username,
        Key: "stale.bin",
        UploadId: withParts.UploadId!,
        PartNumber: 1,
        Body: Buffer.alloc(5 * 1024 * 1024, 9),
      }),
    )
    await s3.send(new CreateMultipartUploadCommand({ Bucket: username, Key: "empty.bin" }))

    const listKeys = async () => {
      const res = await s3.send(new ListMultipartUploadsCommand({ Bucket: username }))

      return (res.Uploads ?? []).map((u) => u.Key).sort()
    }

    // Driven by the value the deployed ops container actually has, so the two
    // halves of this file describe one configuration rather than two.
    const maxAgeDays = Number(deployedMultipartMaxAgeDays())
    const opsEnv = { KURA_FILE_TTL_DAYS: "", KURA_MULTIPART_MAX_AGE_DAYS: String(maxAgeDays) }

    // Exactly at the boundary the upload is still within its resume window.
    runOpsDaily(daysFromNow(maxAgeDays - 1), opsEnv)
    expect(await listKeys()).toEqual(["empty.bin", "stale.bin"])

    // Past the window the idle upload goes; the part-less one cannot be dated
    // (SeaweedFS reports no Initiated) and holds no bytes, so it stays.
    runOpsDaily(daysFromNow(maxAgeDays + 1), opsEnv)
    expect(await listKeys()).toEqual(["empty.bin"])
  })
})
