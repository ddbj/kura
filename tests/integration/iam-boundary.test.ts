import { execFileSync } from "node:child_process"
import { createHash, createHmac } from "node:crypto"

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteBucketCorsCommand,
  DeleteBucketEncryptionCommand,
  DeleteBucketLifecycleCommand,
  DeleteBucketOwnershipControlsCommand,
  DeleteBucketPolicyCommand,
  DeleteBucketTaggingCommand,
  DeleteObjectCommand,
  DeletePublicAccessBlockCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutBucketAclCommand,
  PutBucketCorsCommand,
  PutBucketEncryptionCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketNotificationConfigurationCommand,
  PutBucketOwnershipControlsCommand,
  PutBucketPolicyCommand,
  PutBucketRequestPaymentCommand,
  PutBucketTaggingCommand,
  PutBucketVersioningCommand,
  PutObjectAclCommand,
  PutObjectCommand,
  PutObjectLegalHoldCommand,
  PutObjectLockConfigurationCommand,
  PutObjectRetentionCommand,
  PutObjectTaggingCommand,
  PutPublicAccessBlockCommand,
  type S3Client,
} from "@aws-sdk/client-s3"
import { SignatureV4 } from "@smithy/signature-v4"
import { describe, expect, inject, it } from "vitest"

import {
  ADMIN_ROLE_ARN,
  assumeRole,
  type AwsCreds,
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
      // A 403 from anywhere but the authorizer (a proxy, a misroute) would
      // pass a bare status check while proving nothing about the boundary.
      expect(await res.text(), `unsigned GET ${path}`).toContain("AccessDenied")
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

// Every bucket and object setting a user could change on their own bucket.
// SeaweedFS adds such operations from release to release, so the list is the
// regression net for the user policy: each one must stay out of reach.
const ownBucketConfigChanges: [string, (s3: S3Client, bucket: string) => Promise<unknown>][] = [
  ["PutBucketPolicy", (s3, b) => s3.send(new PutBucketPolicyCommand({
    Bucket: b,
    Policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: "*", Action: "s3:GetObject", Resource: `arn:aws:s3:::${b}/*` }],
    }),
  }))],
  ["DeleteBucketPolicy", (s3, b) => s3.send(new DeleteBucketPolicyCommand({ Bucket: b }))],
  ["PutBucketAcl", (s3, b) => s3.send(new PutBucketAclCommand({ Bucket: b, ACL: "public-read" }))],
  ["PutObjectAcl", (s3, b) => s3.send(new PutObjectAclCommand({ Bucket: b, Key: "target.txt", ACL: "public-read" }))],
  ["PutBucketCors", (s3, b) => s3.send(new PutBucketCorsCommand({
    Bucket: b,
    CORSConfiguration: { CORSRules: [{ AllowedMethods: ["GET"], AllowedOrigins: ["https://example.org"] }] },
  }))],
  ["DeleteBucketCors", (s3, b) => s3.send(new DeleteBucketCorsCommand({ Bucket: b }))],
  ["PutBucketLifecycleConfiguration", (s3, b) => s3.send(new PutBucketLifecycleConfigurationCommand({
    Bucket: b,
    LifecycleConfiguration: { Rules: [{ ID: "r", Status: "Enabled", Filter: { Prefix: "" }, Expiration: { Days: 1 } }] },
  }))],
  ["DeleteBucketLifecycle", (s3, b) => s3.send(new DeleteBucketLifecycleCommand({ Bucket: b }))],
  ["PutBucketVersioning", (s3, b) => s3.send(new PutBucketVersioningCommand({
    Bucket: b, VersioningConfiguration: { Status: "Enabled" },
  }))],
  ["PutObjectLockConfiguration", (s3, b) => s3.send(new PutObjectLockConfigurationCommand({
    Bucket: b,
    ObjectLockConfiguration: {
      ObjectLockEnabled: "Enabled",
      Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: 1 } },
    },
  }))],
  ["PutObjectRetention", (s3, b) => s3.send(new PutObjectRetentionCommand({
    Bucket: b,
    Key: "target.txt",
    Retention: { Mode: "COMPLIANCE", RetainUntilDate: new Date(Date.now() + 86_400_000) },
  }))],
  ["PutObjectLegalHold", (s3, b) => s3.send(new PutObjectLegalHoldCommand({
    Bucket: b, Key: "target.txt", LegalHold: { Status: "ON" },
  }))],
  ["PutPublicAccessBlock", (s3, b) => s3.send(new PutPublicAccessBlockCommand({
    Bucket: b,
    PublicAccessBlockConfiguration: { BlockPublicAcls: false, BlockPublicPolicy: false },
  }))],
  ["DeletePublicAccessBlock", (s3, b) => s3.send(new DeletePublicAccessBlockCommand({ Bucket: b }))],
  ["PutBucketOwnershipControls", (s3, b) => s3.send(new PutBucketOwnershipControlsCommand({
    Bucket: b, OwnershipControls: { Rules: [{ ObjectOwnership: "ObjectWriter" }] },
  }))],
  ["DeleteBucketOwnershipControls", (s3, b) => s3.send(new DeleteBucketOwnershipControlsCommand({ Bucket: b }))],
  ["PutBucketEncryption", (s3, b) => s3.send(new PutBucketEncryptionCommand({
    Bucket: b,
    ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] },
  }))],
  ["DeleteBucketEncryption", (s3, b) => s3.send(new DeleteBucketEncryptionCommand({ Bucket: b }))],
  ["PutBucketRequestPayment", (s3, b) => s3.send(new PutBucketRequestPaymentCommand({
    Bucket: b, RequestPaymentConfiguration: { Payer: "Requester" },
  }))],
  ["PutBucketNotificationConfiguration", (s3, b) => s3.send(new PutBucketNotificationConfigurationCommand({
    Bucket: b, NotificationConfiguration: {},
  }))],
  ["PutBucketTagging", (s3, b) => s3.send(new PutBucketTaggingCommand({
    Bucket: b, Tagging: { TagSet: [{ Key: "k", Value: "v" }] },
  }))],
  ["DeleteBucketTagging", (s3, b) => s3.send(new DeleteBucketTaggingCommand({ Bucket: b }))],
  ["DeleteBucket", (s3, b) => s3.send(new DeleteBucketCommand({ Bucket: b }))],
]

// The SeaweedFS quota extension (PUT /<bucket>?seaweedfs-quota) has no SDK
// command, so the request is signed by hand.
type SourceData = string | ArrayBuffer | ArrayBufferView

class NodeSha256 {
  private hash: ReturnType<typeof createHash> | ReturnType<typeof createHmac>
  private readonly secret: SourceData | undefined

  constructor(secret?: SourceData) {
    this.secret = secret
    this.hash = this.fresh()
  }

  private fresh() {
    return this.secret === undefined
      ? createHash("sha256")
      : createHmac("sha256", typeof this.secret === "string" ? this.secret : Buffer.from(this.secret as ArrayBuffer))
  }

  update(data: Uint8Array | string) {
    this.hash.update(data)
  }

  digest() {
    return Promise.resolve(new Uint8Array(this.hash.digest()))
  }

  reset() {
    this.hash = this.fresh()
  }
}

const sendSigned = async (creds: AwsCreds, method: string, path: string, query: Record<string, string>, body: string) => {
  const endpoint = new URL(inject("s3Endpoint"))
  const signer = new SignatureV4({ service: "s3", region: "us-east-1", credentials: creds, sha256: NodeSha256 })
  const signed = await signer.sign({
    method,
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: Number(endpoint.port),
    path,
    query,
    headers: {
      "host": endpoint.host,
      "content-type": "application/json",
      "x-amz-content-sha256": createHash("sha256").update(body).digest("hex"),
    },
    body,
  })
  const qs = new URLSearchParams(query).toString().replace(/=(&|$)/g, "$1")

  return fetch(`${endpoint.origin}${path}?${qs}`, { method, headers: signed.headers, body })
}

describe("own bucket settings", () => {
  it.each(ownBucketConfigChanges)("denies %s on the own bucket", async (_, change) => {
    const { username, s3 } = await setupUser()
    await putText(s3, username, "target.txt", "x")

    await expect(change(s3, username)).rejects.toMatchObject(accessDenied)
  })

  it("denies raising the own quota through the S3 quota extension", async () => {
    const { username, creds } = await setupUser()

    const res = await sendSigned(creds, "PUT", `/${username}`, { "seaweedfs-quota": "" }, JSON.stringify({ quota_size: 1, quota_unit: "TB", quota_enabled: true }))

    expect(res.status).toBe(403)
  })

  it("keeps an object stored with a public-read ACL unreadable without a signature", async () => {
    const { username, s3 } = await setupUser()
    await s3.send(new PutObjectCommand({ Bucket: username, Key: "acl.txt", Body: "x", ACL: "public-read" })).catch(() => undefined)
    const endpoint = inject("s3Endpoint").replace(/\/+$/, "")

    const res = await fetch(`${endpoint}/${username}/acl.txt`)

    expect(res.status).toBe(403)
  })

  it("keeps a bucket created with a public-read ACL unlistable without a signature", async () => {
    const username = uniqueUser()
    const s3 = s3ClientFor(await assumeRole(await signToken({ username })))
    await s3.send(new CreateBucketCommand({ Bucket: username, ACL: "public-read" })).catch(() => undefined)
    await putText(s3, username, "acl.txt", "x").catch(() => undefined)
    const endpoint = inject("s3Endpoint").replace(/\/+$/, "")

    for (const path of [`/${username}?list-type=2`, `/${username}/acl.txt`]) {
      const res = await fetch(`${endpoint}${path}`)
      expect(res.status, `unsigned GET ${path}`).toBe(403)
    }
  })

  // SeaweedFS does not check a permission for the Object Lock flag on
  // CreateBucket, so a user can create such a bucket. Retention and legal hold
  // are what would make objects undeletable, by the owner and by the admin.
  it("denies retention and legal hold in a bucket created with Object Lock enabled", async () => {
    const username = uniqueUser()
    const s3 = s3ClientFor(await assumeRole(await signToken({ username })))
    await s3.send(new CreateBucketCommand({ Bucket: username, ObjectLockEnabledForBucket: true }))
    const retainUntil = new Date(Date.now() + 86_400_000)

    await expect(s3.send(new PutObjectCommand({
      Bucket: username, Key: "locked.txt", Body: "x", ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: retainUntil,
    }))).rejects.toMatchObject(accessDenied)
    await expect(s3.send(new PutObjectCommand({
      Bucket: username, Key: "held.txt", Body: "x", ObjectLockLegalHoldStatus: "ON",
    }))).rejects.toMatchObject(accessDenied)
    await putText(s3, username, "plain.txt", "x")
    await expect(s3.send(new PutObjectRetentionCommand({
      Bucket: username, Key: "plain.txt", Retention: { Mode: "COMPLIANCE", RetainUntilDate: retainUntil },
    }))).rejects.toMatchObject(accessDenied)
    await expect(s3.send(new PutObjectLockConfigurationCommand({
      Bucket: username,
      ObjectLockConfiguration: { ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: 1 } } },
    }))).rejects.toMatchObject(accessDenied)
  })
})
