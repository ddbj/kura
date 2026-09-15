// Manual CLI to wipe every past E2E run's leftovers from the test user's
// bucket. Uses the SeaweedFS root credentials from .env so it works without
// running a Playwright browser or negotiating STS via Keycloak.
//
// Usage:
//   node --experimental-strip-types scripts/e2e-cleanup.ts
//
// An E2E artifact is anything under `e2e/` (the runId-scoped tree), anything
// under a top-level `e2e-*` folder (a folder a test created at the bucket
// root), or any file whose leaf name starts with `e2e-`. This CLI deletes
// those objects, aborts their pending multipart uploads, and removes the filer
// directory entries they leave behind. Prints counts to stdout.

import { readFileSync } from "node:fs"

import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3"

import { collectAllPages, nextMarker } from "../app/lib/s3/paginate.ts"
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
    ContinuationToken = nextMarker(res.NextContinuationToken)
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

const abortPendingMatching = async (match: (key: string) => boolean): Promise<number> => {
  let aborted = 0
  let KeyMarker: string | undefined
  let UploadIdMarker: string | undefined
  for (;;) {
    const res = await s3.send(new ListMultipartUploadsCommand({
      Bucket: bucket,
      KeyMarker,
      UploadIdMarker,
    }))
    for (const u of res.Uploads ?? []) {
      if (!u.Key || !u.UploadId || !match(u.Key)) continue
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

// SeaweedFS keeps a filer directory entry after every child object is gone, so
// an emptied folder still comes back in CommonPrefixes and the SPA keeps
// rendering a row for it. DeleteObject on the slash-terminated key removes the
// directory itself — the same call the SPA makes after folder delete / move.
const listChildDirectories = async (prefix: string): Promise<string[]> =>
  collectAllPages(
    (token: string | undefined) => s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: "/",
      ContinuationToken: token,
    })),
    (page) => (page.CommonPrefixes ?? []).map((p) => p.Prefix).filter((p) => p !== undefined),
    (page) => nextMarker(page.NextContinuationToken),
  )

// Depth first: a directory only disappears once its children are gone. A
// directory that still holds objects is left alone — the caller only ever
// points this at E2E scopes, but a stray non-E2E file must not be orphaned.
const removeEmptyDirectories = async (prefix: string): Promise<number> => {
  let removed = 0
  for (const child of await listChildDirectories(prefix)) {
    removed += await removeEmptyDirectories(child)
  }
  if ((await listAllUnder(prefix)).length > 0) return removed
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: prefix }))

  return removed + 1
}

const isE2eDirectory = (prefix: string): boolean => prefix === "e2e/" || prefix.startsWith("e2e-")
const leafName = (key: string): string => key.slice(key.lastIndexOf("/") + 1)

// A `.keep` marker inside `e2e-something/` matches neither the `e2e/` tree nor
// the `e2e-` leaf rule, so scope by the top-level folder as well — otherwise
// the folder survives with its marker and keeps showing up in the SPA.
const scopes = ["e2e/", ...(await listChildDirectories("")).filter(isE2eDirectory)]
const isE2eKey = (key: string): boolean =>
  scopes.some((scope) => key.startsWith(scope)) || leafName(key).startsWith("e2e-")

const deletedCount = await deleteBatch((await listAllUnder("")).filter(isE2eKey))
const abortedCount = await abortPendingMatching(isE2eKey)

// Re-list after the deletes so only directories that still exist are visited.
let removedDirs = 0
for (const dir of (await listChildDirectories("")).filter(isE2eDirectory)) {
  removedDirs += await removeEmptyDirectories(dir)
}

console.log(
  `e2e-cleanup: bucket=${bucket} deleted=${deletedCount} aborted=${abortedCount} directories=${removedDirs}`,
)
