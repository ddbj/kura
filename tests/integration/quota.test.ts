import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import { describe, expect, it } from "vitest"

import { eventually, setupUser, weedShell } from "./_helpers"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const REQUIRED_ENV = [
  "KURA_OIDC_ISSUER=x",
  "KURA_OIDC_CLIENT_ID=x",
  "KURA_OIDC_JWKS_URI=x",
  "KURA_STS_SIGNING_KEY=x",
  "KURA_ROOT_ACCESS_KEY=x",
  "KURA_ROOT_SECRET_KEY=x",
  "KURA_FILER_JWT_KEY=x",
]

// The invalid-value path exits before touching anything SeaweedFS-specific,
// so a bare shell image is enough to exercise the real entrypoint.sh.
const runEntrypoint = (quota: string) =>
  execFileSync("docker", [
    "run", "--rm",
    ...REQUIRED_ENV.flatMap((kv) => ["-e", kv]),
    "-e", `KURA_QUOTA_DEFAULT_MB=${quota}`,
    "-v", `${join(repoRoot, "seaweedfs", "entrypoint.sh")}:/kura-entrypoint.sh:ro`,
    "alpine:3", "sh", "/kura-entrypoint.sh",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

describe("quota env startup validation", () => {
  it.each(["0", "-1", "abc"])("KURA_QUOTA_DEFAULT_MB=%s fails startup", (quota) => {
    expect(() => runEntrypoint(quota)).toThrowError(/KURA_QUOTA_DEFAULT_MB must be a positive integer/)
  })
})

describe("bucket quota", () => {
  it("rejects writes while over quota, keeps read/delete, and recovers", { timeout: 360_000 }, async () => {
    const { username, s3 } = await setupUser()
    weedShell(`s3.bucket.quota -name=${username} -op=set -sizeMB=1`)

    await s3.send(
      new PutObjectCommand({
        Bucket: username,
        Key: "fill.bin",
        Body: Buffer.alloc(2 * 1024 * 1024, 1),
      }),
    )

    // Enforcement recomputes sizes asynchronously; poll until the write flips
    // to rejected.
    const overQuotaStatus = await eventually(async () => {
      weedShell("s3.bucket.quota.enforce -apply")
      const status = await s3
        .send(new PutObjectCommand({ Bucket: username, Key: "probe.bin", Body: "x" }))
        .then(
          () => undefined,
          (err: { $metadata?: { httpStatusCode?: number } }) =>
            err.$metadata?.httpStatusCode,
        )
      if (status === undefined) {
        throw new Error("write not rejected yet")
      }

      return status
    })
    // The filer rejects read-only writes with 507, which the S3 layer
    // surfaces as a generic 500 InternalError.
    expect(overQuotaStatus).toBe(500)

    // Reads and deletes must keep working while read-only.
    const got = await s3.send(new GetObjectCommand({ Bucket: username, Key: "fill.bin" }))
    expect((await got.Body!.transformToByteArray()).length).toBe(2 * 1024 * 1024)
    await s3.send(new DeleteObjectCommand({ Bucket: username, Key: "fill.bin" }))

    // After deletion the bucket must become writable again. The logical size
    // only drops after the deleted needles are vacuumed, so compact this
    // bucket's collection while polling.
    await eventually(
      async () => {
        weedShell(`volume.vacuum -garbageThreshold=0.0001 -collection=${username}`)
        weedShell("s3.bucket.quota.enforce -apply")
        await s3.send(
          new PutObjectCommand({ Bucket: username, Key: "recovered.txt", Body: "ok" }),
        )
      },
      180_000,
      5_000,
    )
  })
})
