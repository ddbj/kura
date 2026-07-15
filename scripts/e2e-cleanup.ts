// Manual CLI to wipe every past E2E run's leftovers from the test user's
// bucket. Uses the SeaweedFS root credentials from .env so it works without
// running a Playwright browser or negotiating STS via Keycloak.
//
// Usage:
//   node --experimental-strip-types scripts/e2e-cleanup.ts
//
// Deletes any object whose key is either under `e2e/` (runId-scoped) or has a
// leaf name starting with `e2e-` at any depth. Aborts any pending multipart
// upload under the same scope. Prints counts to stdout.

import { readFileSync } from "node:fs"

import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3"

import { SEAWEEDFS_S3_CLIENT_OPTIONS } from "../app/lib/s3/seaweedfs-compat.ts"

const readEnvFile = (path: string): Record<string, string> => {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return {}
  }

  return Object.fromEntries(
    text
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => {
        const idx = line.indexOf("=")

        return [line.slice(0, idx), line.slice(idx + 1)] as const
      }),
  )
}

const require_ = (name: string, source: Record<string, string>): string => {
  const value = source[name] ?? process.env[name]
  if (value === undefined || value === "") {
    throw new Error(`e2e-cleanup: ${name} is not set (put it in .env)`)
  }

  return value
}

const dotenv = readEnvFile(new URL("../.env", import.meta.url).pathname)
const username = require_("E2E_USERNAME", dotenv)
const accessKeyId = require_("KURA_ROOT_ACCESS_KEY", dotenv)
const secretAccessKey = require_("KURA_ROOT_SECRET_KEY", dotenv)
const endpoint = process.env["KURA_E2E_S3_ENDPOINT"] ?? "http://localhost:28333"

const s3 = new S3Client({
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
  ...SEAWEEDFS_S3_CLIENT_OPTIONS,
})

const bucket = username

const listAllUnder = async (prefix: string): Promise<string[]> => {
  const keys: string[] = []
  let ContinuationToken: string | undefined
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken }))
    for (const c of res.Contents ?? []) {
      if (c.Key) keys.push(c.Key)
    }
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (ContinuationToken)

  return keys
}

const deleteBatch = async (keys: string[]): Promise<number> => {
  let deleted = 0
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }))
    deleted += batch.length
  }

  return deleted
}

const abortPendingUnder = async (prefix: string): Promise<number> => {
  let aborted = 0
  let KeyMarker: string | undefined
  let UploadIdMarker: string | undefined
  for (;;) {
    const res = await s3.send(new ListMultipartUploadsCommand({
      Bucket: bucket,
      Prefix: prefix,
      KeyMarker,
      UploadIdMarker,
    }))
    for (const u of res.Uploads ?? []) {
      if (!u.Key || !u.UploadId) continue
      await s3.send(new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: u.Key,
        UploadId: u.UploadId,
      }))
      aborted++
    }
    if (!res.IsTruncated) break
    KeyMarker = res.NextKeyMarker
    UploadIdMarker = res.NextUploadIdMarker
    if (!KeyMarker && !UploadIdMarker) break
  }

  return aborted
}

const scopedKeys = await listAllUnder("e2e/")
const rootKeys = (await listAllUnder("")).filter((k) => {
  const leaf = k.slice(k.lastIndexOf("/") + 1)

  return leaf.startsWith("e2e-")
})
const allKeys = [...new Set([...scopedKeys, ...rootKeys])]

const deletedCount = await deleteBatch(allKeys)
const scopedAborts = await abortPendingUnder("e2e/")

console.log(`e2e-cleanup: bucket=${bucket} deleted=${deletedCount} aborted=${scopedAborts}`)
