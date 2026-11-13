import { execFileSync } from "node:child_process"
import { createHash, createHmac, randomBytes } from "node:crypto"

import {
  AbortMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
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
  HeadBucketCommand,
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
  rootS3Client,
  s3ClientFor,
  setupUser,
  signToken,
  uniqueSub,
} from "./_helpers"

const accessDenied = { $metadata: { httpStatusCode: 403 } }

describe("IAM policy boundary", () => {
  it("allows creating own bucket and denies creating another user's bucket", async () => {
    const { s3 } = await setupUser() // setupUser already creates the own bucket

    await expect(
      s3.send(new CreateBucketCommand({ Bucket: uniqueSub() })),
    ).rejects.toMatchObject(accessDenied)
  })

  // The bucket name comes from sub alone. A username is not a valid bucket
  // name for a quarter of the accounts, and two accounts can never share a sub.
  it("denies creating a bucket named after the own username", async () => {
    const username = `u${randomBytes(6).toString("hex")}`
    const s3 = s3ClientFor(await assumeRole(await signToken({ sub: uniqueSub(), username })))

    await expect(
      s3.send(new CreateBucketCommand({ Bucket: username })),
    ).rejects.toMatchObject(accessDenied)
  })

  it("serves a token that carries no username", async () => {
    const sub = uniqueSub()
    const s3 = s3ClientFor(await assumeRole(await signToken({ sub, username: null })))

    await s3.send(new CreateBucketCommand({ Bucket: sub }))
    await putText(s3, sub, "a.txt", "no username")
    const got = await s3.send(new GetObjectCommand({ Bucket: sub, Key: "a.txt" }))
    expect(await got.Body!.transformToString()).toBe("no username")
  })

  // An admin moves data into a bucket named after the owner's sub. The owner
  // did not create that bucket and must still have the run of it.
  it("gives a user the bucket an admin created under their sub", async () => {
    const sub = uniqueSub()
    const root = rootS3Client()
    await root.send(new CreateBucketCommand({ Bucket: sub }))
    await putText(root, sub, "moved/data.txt", "moved by admin")

    const s3 = s3ClientFor(await assumeRole(await signToken({ sub })))
    await s3.send(new HeadBucketCommand({ Bucket: sub }))
    const got = await s3.send(new GetObjectCommand({ Bucket: sub, Key: "moved/data.txt" }))
    expect(await got.Body!.transformToString()).toBe("moved by admin")
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: sub }))
    expect(listed.Contents?.map((o) => o.Key)).toEqual(["moved/data.txt"])
    await putText(s3, sub, "new.txt", "written by owner")
    await s3.send(new DeleteObjectCommand({ Bucket: sub, Key: "moved/data.txt" }))
    const upload = await s3.send(new CreateMultipartUploadCommand({ Bucket: sub, Key: "big.bin" }))
    expect((await s3.send(new ListMultipartUploadsCommand({ Bucket: sub }))).Uploads).toHaveLength(1)
    await s3.send(new AbortMultipartUploadCommand({ Bucket: sub, Key: "big.bin", UploadId: upload.UploadId }))
  })

  it("allows read / write / list / tagging in the own bucket", async () => {
    const { sub, s3 } = await setupUser()
    await putText(s3, sub, "a/b.txt", "own")

    const got = await s3.send(new GetObjectCommand({ Bucket: sub, Key: "a/b.txt" }))
    expect(await got.Body!.transformToString()).toBe("own")

    const listed = await s3.send(new ListObjectsV2Command({ Bucket: sub, Prefix: "a/" }))
    expect(listed.Contents?.map((o) => o.Key)).toContain("a/b.txt")

    await s3.send(
      new PutObjectTaggingCommand({
        Bucket: sub,
        Key: "a/b.txt",
        Tagging: { TagSet: [{ Key: "kura-test", Value: "1" }] },
      }),
    )
    const tags = await s3.send(
      new GetObjectTaggingCommand({ Bucket: sub, Key: "a/b.txt" }),
    )
    expect(tags.TagSet).toContainEqual({ Key: "kura-test", Value: "1" })

    await s3.send(new DeleteObjectCommand({ Bucket: sub, Key: "a/b.txt" }))
  })

  it("denies read / write / list / tagging on another user's bucket", async () => {
    const alice = await setupUser()
    const bob = await setupUser()
    await putText(bob.s3, bob.sub, "secret.txt", "bob only")

    await expect(
      alice.s3.send(new GetObjectCommand({ Bucket: bob.sub, Key: "secret.txt" })),
    ).rejects.toMatchObject(accessDenied)
    await expect(
      alice.s3.send(
        new PutObjectCommand({ Bucket: bob.sub, Key: "intruder.txt", Body: "x" }),
      ),
    ).rejects.toMatchObject(accessDenied)
    await expect(
      alice.s3.send(new ListObjectsV2Command({ Bucket: bob.sub })),
    ).rejects.toMatchObject(accessDenied)
    await expect(
      alice.s3.send(
        new PutObjectTaggingCommand({
          Bucket: bob.sub,
          Key: "secret.txt",
          Tagging: { TagSet: [{ Key: "kura-test", Value: "1" }] },
        }),
      ),
    ).rejects.toMatchObject(accessDenied)
    await expect(
      alice.s3.send(new DeleteObjectCommand({ Bucket: bob.sub, Key: "secret.txt" })),
    ).rejects.toMatchObject(accessDenied)
    await expect(
      alice.s3.send(new ListMultipartUploadsCommand({ Bucket: bob.sub })),
    ).rejects.toMatchObject(accessDenied)
  })

  it("denies assuming KuraAdminRole with a non-admin token", async () => {
    const token = await signToken({ sub: uniqueSub() })

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
    await putText(alice.s3, alice.sub, "data.txt", "readable by admin")

    const adminToken = await signToken({ sub: inject("adminSub") })
    const adminS3 = s3ClientFor(await assumeRole(adminToken, ADMIN_ROLE_ARN))
    const got = await adminS3.send(
      new GetObjectCommand({ Bucket: alice.sub, Key: "data.txt" }),
    )
    expect(await got.Body!.transformToString()).toBe("readable by admin")
  })

  // s3.json defines no anonymous identity, so nothing
  // reaches S3 without a signature. There is no other unauthenticated path
  // into kura, which is what the whole design rests on.
  it("denies unsigned requests to a bucket, an object and the bucket list", async () => {
    const { sub, s3 } = await setupUser()
    await putText(s3, sub, "anon.txt", "not for the world")
    const endpoint = inject("s3Endpoint").replace(/\/+$/, "")

    for (const path of ["/", `/${sub}`, `/${sub}?list-type=2`, `/${sub}/anon.txt`]) {
      const res = await fetch(`${endpoint}${path}`)
      expect(res.status, `unsigned GET ${path}`).toBe(403)
      // A 403 from anywhere but the authorizer (a proxy, a misroute) would
      // pass a bare status check while proving nothing about the boundary.
      expect(await res.text(), `unsigned GET ${path}`).toContain("AccessDenied")
    }
  })

  // The master, the filer and the volume server accept any caller that
  // reaches them, and the filer's gRPC port alone is enough to read, write and
  // delete every bucket. They all run in one process, so they listen on the
  // container's loopback only. The listeners are read from the container
  // instead of probing a fixed list, because SeaweedFS adds ports from release
  // to release.
  it("listens beyond the container's loopback on the S3 ports only", () => {
    const listeners = execFileSync("docker", [
      "exec", "kura-test-seaweedfs-1", "netstat", "-ltn",
    ], { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.includes("LISTEN"))
      .map((line) => line.trim().split(/\s+/)[3]!)

    // Control: the loopback listeners are visible, so the filter below is
    // what removes them, not a netstat that prints nothing.
    expect(listeners).toContain("127.0.0.1:18888")

    const exposed = listeners
      .filter((address) => !address.startsWith("127."))
      .map((address) => Number(address.slice(address.lastIndexOf(":") + 1)))
      .sort((x, y) => x - y)

    // 8333 is the S3 API and 18333 its gRPC port, which follows the same bind.
    expect(exposed).toEqual([8333, 18333])
  })

  // The filer's own HTTP API is not behind S3's IAM. security.toml's read
  // signing key keeps it closed to a caller that does reach the filer.
  it("denies an unauthenticated filer read", () => {
    const status = execFileSync("docker", [
      "exec", "kura-test-seaweedfs-1", "sh", "-c",
      "wget -S -q -O /dev/null http://127.0.0.1:8888/buckets/ 2>&1 | awk '/HTTP\\//{print $2; exit}'",
    ], { encoding: "utf8" }).trim()

    expect(status).toBe("401")
  })

  // The SPA delivery process is the one container that takes requests from
  // outside and never talks to SeaweedFS, so it sits on a network of its own.
  it("keeps SeaweedFS out of reach of the SPA delivery container", () => {
    const address = execFileSync("docker", [
      "inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", "kura-test-seaweedfs-1",
    ], { encoding: "utf8" }).trim().split(/\s+/)[0]!
    expect(address).toMatch(/^\d+\.\d+\.\d+\.\d+$/)

    const probe = (container: string, host: string) =>
      execFileSync("docker", [
        "exec", container, "sh", "-c",
        `for p in 8333 18333 8888 18888 9333 19333 8082 18082; do nc -z -w 2 ${host} $p 2>/dev/null && printf '%s ' $p; done; true`,
      ], { encoding: "utf8" }).trim()

    // Control: the same probe from a container that shares the network sees
    // the S3 ports, so an empty result below means "unreachable", not "no nc".
    expect(probe("kura-test-ops-1", address)).toBe("8333 18333")

    expect(probe("kura-test-web-1", "seaweedfs")).toBe("")
    expect(probe("kura-test-web-1", address)).toBe("")
  }, 60_000)

  it("rejects tokens with a wrong audience", async () => {
    const token = await signToken({ sub: uniqueSub(), aud: "someone-else" })

    // Audience mismatch is a token validation failure, not a policy failure,
    // so STS returns InvalidParameterValue (400) rather than 5xx.
    await expect(assumeRole(token)).rejects.toMatchObject({
      $metadata: { httpStatusCode: 400 },
      name: "InvalidParameterValue",
    })
  })

  it("rejects expired tokens", async () => {
    const token = await signToken({ sub: uniqueSub(), lifetimeSeconds: -60 })

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
    const { sub, s3 } = await setupUser()
    await putText(s3, sub, "target.txt", "x")

    await expect(change(s3, sub)).rejects.toMatchObject(accessDenied)
  })

  it("denies raising the own quota through the S3 quota extension", async () => {
    const { sub, creds } = await setupUser()

    const res = await sendSigned(creds, "PUT", `/${sub}`, { "seaweedfs-quota": "" }, JSON.stringify({ quota_size: 1, quota_unit: "TB", quota_enabled: true }))

    expect(res.status).toBe(403)
  })

  it("keeps an object stored with a public-read ACL unreadable without a signature", async () => {
    const { sub, s3 } = await setupUser()
    await s3.send(new PutObjectCommand({ Bucket: sub, Key: "acl.txt", Body: "x", ACL: "public-read" })).catch(() => undefined)
    const endpoint = inject("s3Endpoint").replace(/\/+$/, "")

    const res = await fetch(`${endpoint}/${sub}/acl.txt`)

    expect(res.status).toBe(403)
  })

  it("keeps a bucket created with a public-read ACL unlistable without a signature", async () => {
    const sub = uniqueSub()
    const s3 = s3ClientFor(await assumeRole(await signToken({ sub })))
    await s3.send(new CreateBucketCommand({ Bucket: sub, ACL: "public-read" })).catch(() => undefined)
    await putText(s3, sub, "acl.txt", "x").catch(() => undefined)
    const endpoint = inject("s3Endpoint").replace(/\/+$/, "")

    for (const path of [`/${sub}?list-type=2`, `/${sub}/acl.txt`]) {
      const res = await fetch(`${endpoint}${path}`)
      expect(res.status, `unsigned GET ${path}`).toBe(403)
    }
  })

  // SeaweedFS does not check a permission for the Object Lock flag on
  // CreateBucket, so a user can create such a bucket. Retention and legal hold
  // are what would make objects undeletable, by the owner and by the admin.
  it("denies retention and legal hold in a bucket created with Object Lock enabled", async () => {
    const sub = uniqueSub()
    const s3 = s3ClientFor(await assumeRole(await signToken({ sub })))
    await s3.send(new CreateBucketCommand({ Bucket: sub, ObjectLockEnabledForBucket: true }))
    const retainUntil = new Date(Date.now() + 86_400_000)

    await expect(s3.send(new PutObjectCommand({
      Bucket: sub, Key: "locked.txt", Body: "x", ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: retainUntil,
    }))).rejects.toMatchObject(accessDenied)
    await expect(s3.send(new PutObjectCommand({
      Bucket: sub, Key: "held.txt", Body: "x", ObjectLockLegalHoldStatus: "ON",
    }))).rejects.toMatchObject(accessDenied)
    await putText(s3, sub, "plain.txt", "x")
    await expect(s3.send(new PutObjectRetentionCommand({
      Bucket: sub, Key: "plain.txt", Retention: { Mode: "COMPLIANCE", RetainUntilDate: retainUntil },
    }))).rejects.toMatchObject(accessDenied)
    await expect(s3.send(new PutObjectLockConfigurationCommand({
      Bucket: sub,
      ObjectLockConfiguration: { ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: 1 } } },
    }))).rejects.toMatchObject(accessDenied)
  })
})
