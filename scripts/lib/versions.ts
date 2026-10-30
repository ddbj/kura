import type { ListObjectVersionsCommandOutput, ObjectIdentifier, S3Client } from "@aws-sdk/client-s3"
import { DeleteObjectsCommand, GetBucketVersioningCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3"

const DELETE_BATCH = 1000

// A user can turn versioning on only by creating their bucket with Object Lock:
// SeaweedFS does not check a permission for that flag on CreateBucket, and
// KuraUserPolicy allows neither PutBucketVersioning nor any version operation.
// In such a bucket a delete or an overwrite leaves the old content behind,
// counted against the quota and out of the owner's reach. kura has no
// versioning, so every old version and delete marker is removed, whatever the
// file TTL.
export type VersionPurgeResult =
  | { versioned: false }
  | { versioned: true; deleted: number; failed: number }

type Listing = { oldVersions: ObjectIdentifier[]; deleteMarkers: ObjectIdentifier[] }

const truthy = (value: string | undefined): value is string =>
  value !== undefined && value !== ""

// The latest version of each key is the file the owner sees; everything else
// goes. A delete marker goes even when it is the latest: once the versions
// under it are gone it hides nothing.
const listVersions = async (s3: S3Client, bucket: string): Promise<Listing> => {
  const listing: Listing = { oldVersions: [], deleteMarkers: [] }
  let keyMarker: string | undefined
  let versionIdMarker: string | undefined
  for (;;) {
    const page: ListObjectVersionsCommandOutput = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        ...(truthy(keyMarker) ? { KeyMarker: keyMarker } : {}),
        ...(truthy(versionIdMarker) ? { VersionIdMarker: versionIdMarker } : {}),
      }),
    )
    for (const version of page.Versions ?? []) {
      if (version.Key !== undefined && version.VersionId !== undefined && version.IsLatest !== true) {
        listing.oldVersions.push({ Key: version.Key, VersionId: version.VersionId })
      }
    }
    for (const marker of page.DeleteMarkers ?? []) {
      if (marker.Key !== undefined && marker.VersionId !== undefined) {
        listing.deleteMarkers.push({ Key: marker.Key, VersionId: marker.VersionId })
      }
    }
    // Advance on the Next* markers only, not IsTruncated (SeaweedFS has been
    // observed with IsTruncated=true and no marker on other list APIs). A
    // marker that does not move would repeat this page forever.
    const nextKeyMarker = page.NextKeyMarker
    const nextVersionIdMarker = page.NextVersionIdMarker
    if (!truthy(nextKeyMarker) && !truthy(nextVersionIdMarker)) return listing
    if (nextKeyMarker === keyMarker && nextVersionIdMarker === versionIdMarker) {
      throw new Error(`ListObjectVersions on ${bucket} returned the same marker twice`)
    }
    keyMarker = nextKeyMarker
    versionIdMarker = nextVersionIdMarker
  }
}

const deleteAll = async (
  s3: S3Client,
  bucket: string,
  objects: readonly ObjectIdentifier[],
): Promise<{ deleted: number; failed: number }> => {
  let deleted = 0
  let failed = 0
  for (let i = 0; i < objects.length; i += DELETE_BATCH) {
    const batch = objects.slice(i, i + DELETE_BATCH)
    let res
    try {
      res = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch, Quiet: true } }))
    } catch (err) {
      console.error(`kura-ops: version delete batch failed: ${bucket}: ${String(err)}`)
      failed += batch.length
      continue
    }
    const errors = res.Errors ?? []
    for (const error of errors) {
      console.error(`kura-ops: version delete failed: ${bucket}/${error.Key ?? "?"} (${error.VersionId ?? "?"}): ${error.Message ?? "?"}`)
    }
    failed += errors.length
    deleted += batch.length - errors.length
  }

  return { deleted, failed }
}

export const purgeOldVersions = async (s3: S3Client, bucket: string): Promise<VersionPurgeResult> => {
  const versioning = await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }))
  if (versioning.Status !== "Enabled" && versioning.Status !== "Suspended") {
    return { versioned: false }
  }

  const { oldVersions, deleteMarkers } = await listVersions(s3, bucket)
  // Old versions before delete markers: removing the marker over a version
  // that failed to delete would bring a deleted file back into the listing.
  // The markers wait for the retry that a failure triggers.
  const versions = await deleteAll(s3, bucket, oldVersions)
  if (versions.failed > 0) {
    return { versioned: true, deleted: versions.deleted, failed: versions.failed }
  }
  const markers = await deleteAll(s3, bucket, deleteMarkers)

  return { versioned: true, deleted: versions.deleted + markers.deleted, failed: markers.failed }
}
