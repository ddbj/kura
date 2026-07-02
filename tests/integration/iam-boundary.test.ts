import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  PutObjectTaggingCommand,
} from "@aws-sdk/client-s3"
import { describe, expect, inject, it } from "vitest"

import {
  ADMIN_ROLE_ARN,
  assumeRole,
  putText,
  s3ClientFor,
  setupUser,
  signToken,
  uniqueUser,
} from "./_helpers"

const accessDenied = { $metadata: { httpStatusCode: 403 } }

describe("IAM policy boundary", () => {
  it("allows creating own bucket and denies creating another user's bucket", async () => {
    const { s3 } = await setupUser() // setupUser already creates the own bucket

    await expect(
      s3.send(new CreateBucketCommand({ Bucket: uniqueUser() })),
    ).rejects.toMatchObject(accessDenied)
  })

  it("allows read / write / list / tagging in the own bucket", async () => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "a/b.txt", "own")

    const got = await s3.send(new GetObjectCommand({ Bucket: username, Key: "a/b.txt" }))
    expect(await got.Body!.transformToString()).toBe("own")

    const listed = await s3.send(new ListObjectsV2Command({ Bucket: username, Prefix: "a/" }))
    expect(listed.Contents?.map((o) => o.Key)).toContain("a/b.txt")

    await s3.send(
      new PutObjectTaggingCommand({
        Bucket: username,
        Key: "a/b.txt",
        Tagging: { TagSet: [{ Key: "kura-public", Value: "true" }] },
      }),
    )
    const tags = await s3.send(
      new GetObjectTaggingCommand({ Bucket: username, Key: "a/b.txt" }),
    )
    expect(tags.TagSet).toContainEqual({ Key: "kura-public", Value: "true" })

    await s3.send(new DeleteObjectCommand({ Bucket: username, Key: "a/b.txt" }))
  })

  it("denies read / write / list / tagging on another user's bucket", async () => {
    const alice = await setupUser()
    const bob = await setupUser()
    await putText(bob.s3, bob.username, "secret.txt", "bob only")

    await expect(
      alice.s3.send(new GetObjectCommand({ Bucket: bob.username, Key: "secret.txt" })),
    ).rejects.toMatchObject(accessDenied)
    await expect(
      alice.s3.send(
        new PutObjectCommand({ Bucket: bob.username, Key: "intruder.txt", Body: "x" }),
      ),
    ).rejects.toMatchObject(accessDenied)
    await expect(
      alice.s3.send(new ListObjectsV2Command({ Bucket: bob.username })),
    ).rejects.toMatchObject(accessDenied)
    await expect(
      alice.s3.send(
        new PutObjectTaggingCommand({
          Bucket: bob.username,
          Key: "secret.txt",
          Tagging: { TagSet: [{ Key: "kura-public", Value: "true" }] },
        }),
      ),
    ).rejects.toMatchObject(accessDenied)
    await expect(
      alice.s3.send(new DeleteObjectCommand({ Bucket: bob.username, Key: "secret.txt" })),
    ).rejects.toMatchObject(accessDenied)
  })

  it("denies assuming KuraAdminRole with a non-admin token", async () => {
    const token = await signToken({ username: uniqueUser() })

    await expect(assumeRole(token, ADMIN_ROLE_ARN)).rejects.toMatchObject({
      $metadata: { httpStatusCode: expect.any(Number) },
    })
    await expect(assumeRole(token, ADMIN_ROLE_ARN)).rejects.toThrow()
  })

  it("allows a configured admin sub to access any bucket", async () => {
    const alice = await setupUser()
    await putText(alice.s3, alice.username, "data.txt", "readable by admin")

    const adminToken = await signToken({ username: uniqueUser(), sub: inject("adminSub") })
    const adminS3 = s3ClientFor(await assumeRole(adminToken, ADMIN_ROLE_ARN))
    const got = await adminS3.send(
      new GetObjectCommand({ Bucket: alice.username, Key: "data.txt" }),
    )
    expect(await got.Body!.transformToString()).toBe("readable by admin")
  })

  it("rejects tokens with a wrong audience", async () => {
    const token = await signToken({ username: uniqueUser(), aud: "someone-else" })

    await expect(assumeRole(token)).rejects.toThrow()
  })

  it("rejects expired tokens", async () => {
    const token = await signToken({ username: uniqueUser(), lifetimeSeconds: -60 })

    await expect(assumeRole(token)).rejects.toThrow()
  })
})
