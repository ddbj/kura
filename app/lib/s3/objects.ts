import type { ListObjectsV2CommandOutput, S3Client } from "@aws-sdk/client-s3"
import { CopyObjectCommand, CreateBucketCommand, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { encodeFilenameStrict, encodeStrictKey, entryName } from "./keys"
import { collectAllPages } from "./paginate"

export type FileEntry = {
  key: string
  // undefined when the server omitted <Size>; callers decide whether to treat
  // that as zero or as "unknown". Silently coercing to 0 would hide a broken
  // listing under a valid-looking total.
  size: number | undefined
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
      : [{ key: o.Key, size: o.Size, lastModified: o.LastModified ?? new Date(0) }])

  return {
    dirs,
    files,
    ...(res.NextContinuationToken === undefined ? {} : { nextToken: res.NextContinuationToken }),
  }
}

export const deleteObject = async (s3: S3Client, bucket: string, key: string): Promise<void> => {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

// SeaweedFS keeps directory entries in the filer even after every child object
// is removed, so an "emptied" folder keeps appearing in CommonPrefixes and the
// SPA still renders a row for it. DeleteObject on the directory key (with a
// trailing slash) tells the S3 gateway to remove the filer directory entry;
// SeaweedFS's own S3 handler treats a slash-terminated key as a directory.
// Callers use this after folder rename / folder move / folder delete on the
// vacated source prefix. Best-effort — SeaweedFS may return 404 if the
// directory was never materialized (e.g. lazy create); we swallow it.
export const deleteEmptyDirectory = async (s3: S3Client, bucket: string, prefix: string): Promise<void> => {
  if (prefix === "" || !prefix.endsWith("/")) return
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: prefix }))
  } catch {
    // best-effort: absent directory / permission edge cases are non-fatal
  }
}

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
    CopySource: `${bucket}/${encodeStrictKey(srcKey)}`,
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

// A failure of the DeleteObjects request itself (network / 5xx) previously
// aborted with any prior chunks' successes dropped on the floor. Aggregate
// per chunk instead, so the caller sees exactly which keys landed and which
// ones still need retry.
export const deleteObjects = async (
  s3: S3Client,
  bucket: string,
  keys: readonly string[],
): Promise<DeleteObjectsResult> => {
  const deleted: string[] = []
  const failed: { key: string; message: string }[] = []
  for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
    const chunk = keys.slice(i, i + DELETE_CHUNK)
    try {
      const res = await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: false },
      }))
      for (const d of res.Deleted ?? []) if (d.Key !== undefined) deleted.push(d.Key)
      for (const e of res.Errors ?? []) {
        if (e.Key === undefined) continue
        failed.push({ key: e.Key, message: e.Message ?? e.Code ?? "unknown" })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      for (const key of chunk) failed.push({ key, message })
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
// decides whether to filter them. Size is undefined when the server omitted
// it, mirroring FileEntry.
export const listAllUnderPrefix = async (
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<{ key: string; size: number | undefined }[]> =>
  collectAllPages<ListObjectsV2CommandOutput, { key: string; size: number | undefined }, string>(
    (marker) => s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ...(marker === undefined ? {} : { ContinuationToken: marker }),
    })),
    (page) => (page.Contents ?? []).flatMap((o) =>
      o.Key === undefined ? [] : [{ key: o.Key, size: o.Size }]),
    (page) => {
      const next = page.NextContinuationToken

      return next !== undefined && next !== "" ? next : undefined
    },
  )

// The bytes flow browser <- SeaweedFS directly; the SPA only mints the URL.
export const presignDownloadUrl = (s3: S3Client, bucket: string, key: string): Promise<string> =>
  getSignedUrl(s3, new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeFilenameStrict(entryName(key))}`,
  }), { expiresIn: 300 })
