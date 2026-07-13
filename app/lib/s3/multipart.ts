import type { ListMultipartUploadsCommandOutput, ListPartsCommandOutput, S3Client } from "@aws-sdk/client-s3"
import {
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
} from "@aws-sdk/client-s3"

import { collectAllPages } from "./paginate"

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

type UploadsMarker = { keyMarker?: string; uploadIdMarker?: string }

const truthy = (value: string | undefined): value is string =>
  value !== undefined && value !== ""

// In-flight multipart uploads under a prefix. SeaweedFS reports no Initiated
// timestamp and its upload ids carry no time order, so recency comes from
// part LastModified (listUploadedParts).
export const listPendingUploads = async (
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<PendingUpload[]> =>
  collectAllPages<ListMultipartUploadsCommandOutput, PendingUpload, UploadsMarker>(
    (marker) => s3.send(new ListMultipartUploadsCommand({
      Bucket: bucket,
      Prefix: prefix,
      ...(truthy(marker?.keyMarker) ? { KeyMarker: marker.keyMarker } : {}),
      ...(truthy(marker?.uploadIdMarker) ? { UploadIdMarker: marker.uploadIdMarker } : {}),
    })),
    (page) => (page.Uploads ?? []).flatMap((u) =>
      u.Key !== undefined && u.UploadId !== undefined ? [{ key: u.Key, uploadId: u.UploadId }] : []),
    (page) => {
      const keyMarker = page.NextKeyMarker
      const uploadIdMarker = page.NextUploadIdMarker
      if (!truthy(keyMarker) && !truthy(uploadIdMarker)) return undefined

      return {
        ...(truthy(keyMarker) ? { keyMarker } : {}),
        ...(truthy(uploadIdMarker) ? { uploadIdMarker } : {}),
      }
    },
  )

export const listUploadedParts = async (
  s3: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<UploadedPart[]> =>
  collectAllPages<ListPartsCommandOutput, UploadedPart, string>(
    (marker) => s3.send(new ListPartsCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      ...(marker === undefined ? {} : { PartNumberMarker: marker }),
    })),
    (page) => (page.Parts ?? []).flatMap((part) =>
      part.PartNumber !== undefined && part.Size !== undefined && part.ETag !== undefined
        ? [{
          partNumber: part.PartNumber,
          size: part.Size,
          etag: part.ETag,
          ...(part.LastModified === undefined ? {} : { lastModified: part.LastModified }),
        }]
        : []),
    (page) => truthy(page.NextPartNumberMarker) ? page.NextPartNumberMarker : undefined,
  )

// SeaweedFS sometimes replies to AbortMultipartUpload with a bare 404 that
// carries no NoSuchUpload code — treat any 404 as "already gone" so a race
// with the ops cleanup (or a duplicate discard) still succeeds.
const isNoSuchUpload = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false
  const named = (err as { name?: unknown }).name
  if (named === "NoSuchUpload") return true
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode

  return status === 404
}

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
