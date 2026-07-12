import type { S3Client } from "@aws-sdk/client-s3"
import { CopyObjectCommand, CreateBucketCommand, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { entryName } from "./keys"

export type FileEntry = {
  key: string
  size: number
  lastModified: Date
}

export type DirectoryPage = {
  dirs: string[]
  files: FileEntry[]
  nextToken?: string
}

const hasHttpStatus = (err: unknown, status: number): boolean =>
  typeof err === "object" && err !== null && "$metadata" in err &&
  (err as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode === status

const isNotFound = (err: unknown): boolean => hasHttpStatus(err, 404)

// CreateBucket on an existing bucket returns 409 (BucketAlreadyExists, even
// for the owner), so existence is checked with HeadBucket first
// (docs/architecture.md 配置). Two tabs racing their first access can both
// pass that HeadBucket check, so the loser's CreateBucket 409 is expected
// (not the caller's problem) and treated the same as already-existing.
export const ensureOwnBucket = async (s3: S3Client, bucket: string): Promise<void> => {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }))
    return
  } catch (err) {
    if (!isNotFound(err)) throw err
  }
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }))
  } catch (err) {
    if (!hasHttpStatus(err, 409)) throw err
  }
}

export const listDirectory = async (
  s3: S3Client,
  bucket: string,
  prefix: string,
  continuationToken?: string,
): Promise<DirectoryPage> => {
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    Delimiter: "/",
    ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
  }))
  const dirs = (res.CommonPrefixes ?? []).flatMap((p) => (p.Prefix === undefined ? [] : [p.Prefix]))
  const files = (res.Contents ?? []).flatMap((o) =>
    o.Key === undefined || o.Key === prefix
      ? []
      : [{ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0) }])
  return {
    dirs,
    files,
    ...(res.NextContinuationToken === undefined ? {} : { nextToken: res.NextContinuationToken }),
  }
}

export const deleteObject = async (s3: S3Client, bucket: string, key: string): Promise<void> => {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

// CopySource carries the key inside a URL, so keys with non-ASCII or "?"/"#"
// must be percent-encoded per segment (keeping "/" as the separator).
const encodeCopySourceKey = (key: string): string =>
  key.split("/").map(encodeURIComponent).join("/")

// Server-side copy. TaggingDirective=COPY / MetadataDirective=COPY inherit
// from the source, so the public tag ("kura-public=true") survives rename /
// move and objects don't silently go private.
export const copyObject = async (
  s3: S3Client,
  bucket: string,
  srcKey: string,
  destKey: string,
): Promise<void> => {
  await s3.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: destKey,
    CopySource: `${bucket}/${encodeCopySourceKey(srcKey)}`,
    TaggingDirective: "COPY",
    MetadataDirective: "COPY",
  }))
}

export type DeleteObjectsResult = {
  deleted: string[]
  failed: { key: string; message: string }[]
}

// S3 caps DeleteObjects at 1000 keys per request; chunk transparently.
const DELETE_CHUNK = 1000

export const deleteObjects = async (
  s3: S3Client,
  bucket: string,
  keys: readonly string[],
): Promise<DeleteObjectsResult> => {
  const deleted: string[] = []
  const failed: { key: string; message: string }[] = []
  for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
    const chunk = keys.slice(i, i + DELETE_CHUNK)
    const res = await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: false },
    }))
    for (const d of res.Deleted ?? []) if (d.Key !== undefined) deleted.push(d.Key)
    for (const e of res.Errors ?? []) {
      if (e.Key === undefined) continue
      failed.push({ key: e.Key, message: e.Message ?? e.Code ?? "unknown" })
    }
  }

  return { deleted, failed }
}

// S3 has no atomic rename: CopyObject then DeleteObject. A crash between them
// leaves both copies; callers get best-effort semantics.
export const renameObject = async (
  s3: S3Client,
  bucket: string,
  srcKey: string,
  destKey: string,
): Promise<void> => {
  if (srcKey === destKey) return
  await copyObject(s3, bucket, srcKey, destKey)
  await deleteObject(s3, bucket, srcKey)
}

// Full recursive listing under prefix (no Delimiter), paginated with
// ContinuationToken. Includes marker entries like ".keep" — the caller
// decides whether to filter them.
export const listAllUnderPrefix = async (
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<{ key: string; size: number }[]> => {
  const results: { key: string; size: number }[] = []
  let token: string | undefined
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ...(token === undefined ? {} : { ContinuationToken: token }),
    }))
    for (const o of res.Contents ?? []) {
      if (o.Key === undefined) continue
      results.push({ key: o.Key, size: o.Size ?? 0 })
    }
    token = res.NextContinuationToken
  } while (token !== undefined)

  return results
}

// RFC 5987 attr-char excludes several characters encodeURIComponent leaves
// unescaped, including "'" (which would collide with the UTF-8'' delimiter).
const encodeRfc5987ValueChars = (value: string): string =>
  encodeURIComponent(value).replace(/['()*!]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

// The bytes flow browser <- SeaweedFS directly; the SPA only mints the URL.
export const presignDownloadUrl = (s3: S3Client, bucket: string, key: string): Promise<string> =>
  getSignedUrl(s3, new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeRfc5987ValueChars(entryName(key))}`,
  }), { expiresIn: 300 })
