import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  DeleteObjectTaggingCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  type S3Client,
} from "@aws-sdk/client-s3"
import { describe, expect, inject, it } from "vitest"

import { eventually, publicUrl, putText, setupUser, uniqueUser } from "./_helpers"

const publish = (s3: S3Client, bucket: string, key: string) =>
  s3.send(
    new PutObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
      Tagging: { TagSet: [{ Key: "kura-public", Value: "true" }] },
    }),
  )

const unpublish = (s3: S3Client, bucket: string, key: string) =>
  s3.send(new DeleteObjectTaggingCommand({ Bucket: bucket, Key: key }))

describe("public delivery", () => {
  it("serves an object anonymously only while tagged kura-public=true", async () => {
    const { username, s3 } = await setupUser()
    const key = "dir/sub/hello.txt"
    await putText(s3, username, key, "hello kura")

    const before = await fetch(publicUrl(username, key))
    expect(before.status).toBe(404)

    await publish(s3, username, key)
    const published = await fetch(publicUrl(username, key))
    expect(published.status).toBe(200)
    expect(await published.text()).toBe("hello kura")
    expect(published.headers.get("content-type")).toContain("text/plain")

    await unpublish(s3, username, key)
    const after = await fetch(publicUrl(username, key))
    expect(after.status).toBe(404)
  })

  it("keeps private and missing paths indistinguishable", async () => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "private.txt", "secret")

    const privateRes = await fetch(publicUrl(username, "private.txt"))
    const missingRes = await fetch(publicUrl(username, "no-such-file.txt"))
    const missingUserRes = await fetch(publicUrl(uniqueUser(), "no-such-file.txt"))

    expect(privateRes.status).toBe(404)
    expect(missingRes.status).toBe(404)
    expect(missingUserRes.status).toBe(404)
    const [privateBody, missingBody, missingUserBody] = await Promise.all([
      privateRes.text(),
      missingRes.text(),
      missingUserRes.text(),
    ])
    expect(privateBody).toBe(missingBody)
    expect(missingBody).toBe(missingUserBody)
  })

  it("ignores tag values other than true", async () => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "odd.txt", "x")
    await s3.send(
      new PutObjectTaggingCommand({
        Bucket: username,
        Key: "odd.txt",
        Tagging: { TagSet: [{ Key: "kura-public", Value: "false" }] },
      }),
    )

    const res = await fetch(publicUrl(username, "odd.txt"))
    expect(res.status).toBe(404)
  })

  it("supports Range requests on published objects", async () => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "range.txt", "0123456789")
    await publish(s3, username, "range.txt")

    const res = await fetch(publicUrl(username, "range.txt"), {
      headers: { Range: "bytes=2-5" },
    })
    expect(res.status).toBe(206)
    expect(await res.text()).toBe("2345")
  })

  it("streams a multi-megabyte published object intact", async () => {
    const { username, s3 } = await setupUser()
    const body = Buffer.alloc(8 * 1024 * 1024, 7)
    await s3.send(new PutObjectCommand({ Bucket: username, Key: "big.bin", Body: body }))
    await publish(s3, username, "big.bin")

    const res = await fetch(publicUrl(username, "big.bin"))
    expect(res.status).toBe(200)
    const got = Buffer.from(await res.arrayBuffer())
    expect(got.length).toBe(body.length)
    expect(got.equals(body)).toBe(true)
  })

  it("serves filenames with unicode, spaces, and punctuation", async () => {
    const { username, s3 } = await setupUser()
    const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/")
    const keys = [
      "日本語/ファイル名.txt",
      "a&b.txt",
      "a+b.txt",
      "a=b(1)~!@.txt",
      "space dir/space file.txt",
      "a%b.txt",
      "a?b.txt",
      "a#b.txt",
    ]

    for (const key of keys) {
      await putText(s3, username, key, `content of ${key}`)
      await publish(s3, username, key)
      const res = await fetch(publicUrl(username, encodePath(key)))
      expect(res.status, key).toBe(200)
      expect(await res.text(), key).toBe(`content of ${key}`)
    }
  })

  it("does not serve directories or the bucket root", async () => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "dir/file.txt", "x")
    await publish(s3, username, "dir/file.txt")

    expect((await fetch(publicUrl(username, "dir"))).status).toBe(404)
    expect((await fetch(publicUrl(username, "dir/"))).status).toBe(404)
    expect((await fetch(`${publicUrl(username, "x")}/../`)).status).toBe(404)
  })
})

// Public delivery writes an audit log to a date-stamped file (KURA_LOG_DIR,
// docs/operations.md). Requests hitting other locations (SPA, assets) must
// stay out of it.
describe("public delivery audit log", () => {
  const auditLines = async (needle: string): Promise<string[]> => {
    const dir = join(process.cwd(), "tests", "setup", ".logs")
    const files = (await readdir(dir)).filter((f) => /^access-\d{4}-\d{2}-\d{2}\.log$/.test(f))
    const contents = await Promise.all(files.map((f) => readFile(join(dir, f), "utf8")))

    return contents.flatMap((text) => text.split("\n")).filter((line) => line.includes(needle))
  }

  it("records downloads and 404s with client IP from X-Forwarded-For", async () => {
    const { username, s3 } = await setupUser()
    const key = "audit/file 1.txt"
    const encodedKey = "audit/file%201.txt"
    await putText(s3, username, key, "audited")
    await publish(s3, username, key)

    const ok = await fetch(publicUrl(username, encodedKey), {
      headers: { "X-Forwarded-For": "192.0.2.7" },
    })
    expect(ok.status).toBe(200)
    const missing = await fetch(publicUrl(username, "audit/nope.txt"))
    expect(missing.status).toBe(404)

    const [okLine] = await eventually(async () => {
      const lines = await auditLines(`GET /${username}/${encodedKey}`)
      expect(lines).toHaveLength(1)

      return lines
    }, 10_000, 500)
    // The escaped request line preserves the encoded URI for user attribution.
    expect(okLine).toContain("\t192.0.2.7\t")
    expect(okLine).toContain("\t200\t")

    const [missLine] = await auditLines(`GET /${username}/audit/nope.txt`)
    expect(missLine).toContain("\t404\t")
  })

  it("does not log SPA and asset requests to the audit file", async () => {
    const probe = `_config.json?audit-probe=${uniqueUser()}`
    const probeRes = await fetch(`${inject("publicBase")}/${probe}`)
    expect(probeRes.status).toBe(200)

    // Fire a second request that IS audited (a valid user path returns 404
    // via the auth_request), then wait for its line to appear. Once it has
    // appeared, any log line the probe would have written is already on
    // disk too — nginx serialises access log writes per worker.
    const syncKey = `audit-sync-${uniqueUser()}.txt`
    const syncPath = `${uniqueUser()}/${syncKey}`
    const syncRes = await fetch(`${inject("publicBase")}/${syncPath}`)
    expect(syncRes.status).toBe(404)

    await eventually(async () => {
      const lines = await auditLines(`GET /${syncPath}`)
      expect(lines).toHaveLength(1)
      return lines
    }, 10_000, 200)

    expect(await auditLines(probe)).toHaveLength(0)
  })
})
