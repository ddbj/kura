import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"

import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { AssumeRoleWithWebIdentityCommand, STSClient } from "@aws-sdk/client-sts"
import { importPKCS8, SignJWT } from "jose"
import { inject } from "vitest"

import { SEAWEEDFS_S3_CLIENT_OPTIONS } from "~/lib/s3/seaweedfs-compat"

export const USER_ROLE_ARN = "arn:aws:iam::role/KuraUserRole"
export const ADMIN_ROLE_ARN = "arn:aws:iam::role/KuraAdminRole"

// Unique per call so tests never share buckets (= users) or depend on order.
export const uniqueUser = () => `u${randomBytes(6).toString("hex")}`

interface TokenInput {
  username: string
  sub?: string
  aud?: string
  lifetimeSeconds?: number
}

export const signToken = async ({ username, sub, aud, lifetimeSeconds = 3600 }: TokenInput) => {
  const key = await importPKCS8(inject("jwtPrivateKeyPem"), "RS256")
  const now = Math.floor(Date.now() / 1000)

  return new SignJWT({ preferred_username: username })
    .setProtectedHeader({ alg: "RS256", kid: "kura-test" })
    .setIssuer(inject("oidcIssuer"))
    .setAudience(aud ?? inject("oidcClientId"))
    .setSubject(sub ?? `sub-${username}`)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetimeSeconds)
    .sign(key)
}

export interface AwsCreds {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export const assumeRole = async (
  token: string,
  roleArn: string = USER_ROLE_ARN,
  durationSeconds = 3600,
): Promise<AwsCreds> => {
  const sts = new STSClient({ endpoint: inject("s3Endpoint"), region: "us-east-1" })
  const res = await sts.send(
    new AssumeRoleWithWebIdentityCommand({
      RoleArn: roleArn,
      RoleSessionName: `kura-test-${randomBytes(4).toString("hex")}`,
      WebIdentityToken: token,
      DurationSeconds: durationSeconds,
    }),
  )
  const c = res.Credentials!

  return {
    accessKeyId: c.AccessKeyId!,
    secretAccessKey: c.SecretAccessKey!,
    sessionToken: c.SessionToken!,
  }
}

export const s3ClientFor = (creds: AwsCreds) =>
  new S3Client({
    endpoint: inject("s3Endpoint"),
    credentials: creds,
    ...SEAWEEDFS_S3_CLIENT_OPTIONS,
  })

export const rootS3Client = () =>
  s3ClientFor({
    accessKeyId: inject("rootAccessKey"),
    secretAccessKey: inject("rootSecretKey"),
  })

// A signed-in user with their own (already created) bucket.
export const setupUser = async () => {
  const username = uniqueUser()
  const token = await signToken({ username })
  const creds = await assumeRole(token)
  const s3 = s3ClientFor(creds)
  await s3.send(new CreateBucketCommand({ Bucket: username }))

  return { username, token, creds, s3 }
}

export const putText = (s3: S3Client, bucket: string, key: string, body: string) =>
  s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "text/plain" }),
  )

export const publicUrl = (user: string, path: string) => `${inject("publicBase")}/${user}/${path}`

// Runs weed shell commands inside the test SeaweedFS container. Topology
// commands (volume.vacuum etc.) silently no-op without the exclusive lock,
// so every batch runs wrapped in lock / unlock.
export const weedShell = (...commands: string[]) => {
  const script = ["lock", ...commands, "unlock"].join("\n")

  return execFileSync(
    "docker",
    [
      "exec", "-i", "kura-test-seaweedfs-1",
      "weed", "shell", "-master", "localhost:9333",
    ],
    { encoding: "utf8", input: script },
  )
}

// Polls fn until it stops throwing (states like quota enforcement propagate
// asynchronously in SeaweedFS).
export const eventually = async <T>(
  fn: () => Promise<T>,
  timeoutMs = 90_000,
  intervalMs = 2_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      if (Date.now() > deadline) {
        throw err
      }
      await sleep(intervalMs)
    }
  }
}
