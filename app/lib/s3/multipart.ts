import type { S3Client } from "@aws-sdk/client-s3"
import {
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
} from "@aws-sdk/client-s3"

export type PendingUpload = {
  key: string
  uploadId: string
}

export type UploadedPart = {
  partNumber: number
  size: number
  etag: string
  lastModified?: Date
}

// In-flight multipart uploads under a prefix. SeaweedFS reports no Initiated
// timestamp and its upload ids carry no time order, so recency comes from
// part LastModified (listUploadedParts).
export const listPendingUploads = async (
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<PendingUpload[]> => {
  const uploads: PendingUpload[] = []
  let keyMarker: string | undefined
  let uploadIdMarker: string | undefined
  for (;;) {
    const page = await s3.send(new ListMultipartUploadsCommand({
      Bucket: bucket,
      Prefix: prefix,
      ...(keyMarker === undefined ? {} : { KeyMarker: keyMarker }),
      ...(uploadIdMarker === undefined ? {} : { UploadIdMarker: uploadIdMarker }),
    }))
    for (const upload of page.Uploads ?? []) {
      if (upload.Key !== undefined && upload.UploadId !== undefined) {
        uploads.push({ key: upload.Key, uploadId: upload.UploadId })
      }
    }
    if (page.IsTruncated !== true) {
      return uploads
    }
    keyMarker = page.NextKeyMarker
    uploadIdMarker = page.NextUploadIdMarker
  }
}

export const listUploadedParts = async (
  s3: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<UploadedPart[]> => {
  const parts: UploadedPart[] = []
  let marker: string | undefined
  for (;;) {
    const page = await s3.send(new ListPartsCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      ...(marker === undefined ? {} : { PartNumberMarker: marker }),
    }))
    for (const part of page.Parts ?? []) {
      if (part.PartNumber !== undefined && part.Size !== undefined && part.ETag !== undefined) {
        parts.push({
          partNumber: part.PartNumber,
          size: part.Size,
          etag: part.ETag,
          ...(part.LastModified === undefined ? {} : { lastModified: part.LastModified }),
        })
      }
    }
    if (page.IsTruncated !== true) {
      return parts
    }
    marker = page.NextPartNumberMarker
  }
}

const isNoSuchUpload = (err: unknown): boolean =>
  typeof err === "object" && err !== null && "name" in err &&
  (err as { name: unknown }).name === "NoSuchUpload"

// Discards an interrupted upload and the space its parts hold. Racing a
// duplicate discard (or the ops cleanup) is fine: already-gone is success.
export const abortPendingUpload = async (
  s3: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<void> => {
  try {
    await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
  } catch (err) {
    if (!isNoSuchUpload(err)) throw err
  }
}
