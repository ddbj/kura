import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  CreateMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { describe, expect, inject, it } from "vitest"

import { eventually, putText, setupUser, weedShell } from "./_helpers"

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

describe("ops service env passthrough", () => {
  it("forwards the operator-tunable retention env var into the ops container", () => {
    const printenv = (name: string) =>
      execFileSync("docker", ["exec", "kura-test-ops-1", "printenv", name], { encoding: "utf8" }).trim()

    expect(printenv("KURA_MULTIPART_MAX_AGE_DAYS")).toBe("3")
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

  it("leaves everything alone when the TTL is disabled", async () => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "forever.txt", "f")

    runOpsDaily(daysFromNow(10_000), { KURA_FILE_TTL_DAYS: "" })
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

    // Within the resume window (7 days) nothing is touched.
    runOpsDaily(daysFromNow(6), { KURA_FILE_TTL_DAYS: "" })
    expect(await listKeys()).toEqual(["empty.bin", "stale.bin"])

    // Past the window the idle upload goes; the part-less one cannot be dated
    // (SeaweedFS reports no Initiated) and holds no bytes, so it stays.
    runOpsDaily(daysFromNow(8), { KURA_FILE_TTL_DAYS: "" })
    expect(await listKeys()).toEqual(["empty.bin"])
  })
})
