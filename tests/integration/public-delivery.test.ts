import {
  DeleteObjectTaggingCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  type S3Client,
} from "@aws-sdk/client-s3"
import { describe, expect, it } from "vitest"

import { publicUrl, putText, setupUser, uniqueUser } from "./_helpers"

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
