import type { S3Client } from "@aws-sdk/client-s3"
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
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
