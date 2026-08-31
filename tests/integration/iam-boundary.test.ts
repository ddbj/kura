import { execFileSync } from "node:child_process"

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  ListMultipartUploadsCommand,
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
        Tagging: { TagSet: [{ Key: "kura-test", Value: "1" }] },
      }),
    )
    const tags = await s3.send(
      new GetObjectTaggingCommand({ Bucket: username, Key: "a/b.txt" }),
    )
    expect(tags.TagSet).toContainEqual({ Key: "kura-test", Value: "1" })

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
          Tagging: { TagSet: [{ Key: "kura-test", Value: "1" }] },
        }),
      ),
    ).rejects.toMatchObject(accessDenied)
    await expect(
      alice.s3.send(new DeleteObjectCommand({ Bucket: bob.username, Key: "secret.txt" })),
    ).rejects.toMatchObject(accessDenied)
    await expect(
      alice.s3.send(new ListMultipartUploadsCommand({ Bucket: bob.username })),
    ).rejects.toMatchObject(accessDenied)
  })

  it("denies assuming KuraAdminRole with a non-admin token", async () => {
    const token = await signToken({ username: uniqueUser() })

    // Trust policy checks oidc:sub against KURA_ADMIN_SUBS; a non-admin sub
    // returns AccessDenied (403). A 5xx would mean the STS handler crashed
    // rather than rejecting on policy, so status is asserted concretely.
    await expect(assumeRole(token, ADMIN_ROLE_ARN)).rejects.toMatchObject({
      $metadata: { httpStatusCode: 403 },
      name: "AccessDenied",
    })
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

  // s3.json defines no anonymous identity, so nothing
  // reaches S3 without a signature. There is no other unauthenticated path
  // into kura, which is what the whole design rests on.
  it("denies unsigned requests to a bucket, an object and the bucket list", async () => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "anon.txt", "not for the world")
    const endpoint = inject("s3Endpoint").replace(/\/+$/, "")

    for (const path of ["/", `/${username}`, `/${username}?list-type=2`, `/${username}/anon.txt`]) {
      const res = await fetch(`${endpoint}${path}`)
      expect(res.status, `unsigned GET ${path}`).toBe(403)
    }
  })

  // The filer's own HTTP API is not behind S3's IAM, and every container on
  // the compose network can reach it — including the SPA delivery process,
  // which has no business reading buckets. security.toml's read signing key is
  // what closes that door.
  it("denies an unauthenticated filer read from another container on the network", () => {
    const status = execFileSync("docker", [
      "exec", "kura-test-ops-1", "sh", "-c",
      "wget -S -q -O /dev/null http://seaweedfs:8888/buckets/ 2>&1 | awk '/HTTP\\//{print $2; exit}'",
    ], { encoding: "utf8" }).trim()

    expect(status).toBe("401")
  })

  it("rejects tokens with a wrong audience", async () => {
    const token = await signToken({ username: uniqueUser(), aud: "someone-else" })

    // Audience mismatch is a token validation failure, not a policy failure,
    // so STS returns InvalidParameterValue (400) rather than 5xx.
    await expect(assumeRole(token)).rejects.toMatchObject({
      $metadata: { httpStatusCode: 400 },
      name: "InvalidParameterValue",
    })
  })

  it("rejects expired tokens", async () => {
    const token = await signToken({ username: uniqueUser(), lifetimeSeconds: -60 })

    // An expired JWT (exp in the past) surfaces as ExpiredTokenException
    // (400). A network failure or crash would return no body or 5xx.
    await expect(assumeRole(token)).rejects.toMatchObject({
      $metadata: { httpStatusCode: 400 },
      name: "ExpiredTokenException",
    })
  })
})
