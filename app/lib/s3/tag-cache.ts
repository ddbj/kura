import type { S3Client } from "@aws-sdk/client-s3"
import type { QueryClient } from "@tanstack/react-query"
import { useQueries } from "@tanstack/react-query"

import { getObjectIsPublic } from "./tags"

// Tags do not ride on list responses, so the browse view lazily fetches the
// public flag per visible object and caches it (docs/architecture.md
// frontend). Within this window an external change (e.g. via CLI) may not
// show; the SPA's own publish/unpublish is reflected immediately.
const TAG_STALE_MS = 30_000

export const tagQueryKey = (bucket: string, key: string) => ["tag", bucket, key] as const

export const tagQueryOptions = (s3: S3Client, bucket: string, key: string) => ({
  queryKey: tagQueryKey(bucket, key),
  queryFn: () => getObjectIsPublic(s3, bucket, key),
  staleTime: TAG_STALE_MS,
})

// Records the outcome of a publish/unpublish as the authoritative state.
// Cancel any in-flight tag fetch first so a response that left the server
// before the change cannot overwrite the newer state.
export const applyPublicState = async (
  queryClient: QueryClient,
  bucket: string,
  key: string,
  isPublic: boolean,
): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: tagQueryKey(bucket, key) })
  queryClient.setQueryData(tagQueryKey(bucket, key), isPublic)
}

// Public flags for the objects currently on screen: one parallel lazy query
// per key; undefined while unknown (not fetched yet or errored).
export const useObjectPublicFlags = (
  s3: S3Client,
  bucket: string,
  keys: string[],
): Map<string, boolean | undefined> =>
  useQueries({
    queries: keys.map((key) => tagQueryOptions(s3, bucket, key)),
    combine: (results) => new Map(keys.map((key, i) => [key, results[i]?.data])),
  })
