import type { ListObjectsV2CommandOutput, S3Client } from "@aws-sdk/client-s3"
import { ListObjectsV2Command } from "@aws-sdk/client-s3"

import { collectAllPages, nextMarker } from "./paginate"

export type BucketObjectStat = {
  key: string
  size: number
  lastModifiedMs: number
}

export type FolderStat = {
  bytes: number
  lastModifiedMs: number
}

export type BucketStats = {
  totalBytes: number
  // key は末尾 "/" つきの prefix。値はその配下すべての積算。
  folders: ReadonlyMap<string, FolderStat>
}

// S3 は CommonPrefixes (= フォルダ) にサイズも更新日も返さないので、フォルダ行の
// 値は client 側で畳むしかない。使用量メータのために bucket 全体をどのみち walk
// しているので、その 1 回の走査で全階層ぶんをまとめて作る (追加の list をしない)。
export const foldBucketStats = (objects: readonly BucketObjectStat[]): BucketStats => {
  let totalBytes = 0
  const folders = new Map<string, FolderStat>()
  for (const object of objects) {
    totalBytes += object.size
    // `a/b/c.txt` は `a/` と `a/b/` の両方に積む
    for (let slash = object.key.indexOf("/"); slash !== -1; slash = object.key.indexOf("/", slash + 1)) {
      const prefix = object.key.slice(0, slash + 1)
      const current = folders.get(prefix)
      folders.set(prefix, current === undefined
        ? { bytes: object.size, lastModifiedMs: object.lastModifiedMs }
        : {
          bytes: current.bytes + object.size,
          lastModifiedMs: Math.max(current.lastModifiedMs, object.lastModifiedMs),
        })
    }
  }

  return { totalBytes, folders }
}

// SeaweedFS enforces per-bucket quotas server-side, but S3 exposes neither the
// used bytes nor the configured limit to a client, so the browse view tallies
// bytes by walking ListObjectsV2. Cached for several minutes via TanStack
// Query on the caller side.
export const listBucketStats = async (s3: S3Client, bucket: string): Promise<BucketStats> => {
  const objects = await collectAllPages<ListObjectsV2CommandOutput, BucketObjectStat, string>(
    (marker) => s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      ...(marker === undefined ? {} : { ContinuationToken: marker }),
    })),
    (page) => (page.Contents ?? []).map((o) => ({
      key: o.Key ?? "",
      size: o.Size ?? 0,
      lastModifiedMs: o.LastModified?.getTime() ?? 0,
    })),
    (page) => nextMarker(page.NextContinuationToken),
  )

  return foldBucketStats(objects)
}
