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

// A publish and a later unpublish (or vice versa) of the same object can
// settle out of order (their PutObjectTagging/DeleteObjectTagging responses
// race). Each (bucket, key) tracks the token of its most recently *issued*
// change; applyPublicState only takes effect for that token, so a
// late-arriving response from a superseded change cannot win.
const latestChangeToken = new Map<string, symbol>()
const changeMapKey = (bucket: string, key: string): string => `${bucket}/${key}`

// Call synchronously when a change is issued (react-query's mutation
// onMutate runs at mutate()-call time, in actual call order, unlike
// onSuccess which runs in response-arrival order).
export const beginPublicStateChange = (bucket: string, key: string): symbol => {
  const token = Symbol(changeMapKey(bucket, key))
  latestChangeToken.set(changeMapKey(bucket, key), token)

  return token
}

// Records the outcome of a publish/unpublish as the authoritative state, but
// only if this is still the most recently issued change for (bucket, key)
// (see latestChangeToken above). Cancels any in-flight tag fetch first so a
// response that left the server before the change cannot overwrite it either.
export const applyPublicState = async (
  queryClient: QueryClient,
  bucket: string,
  key: string,
  isPublic: boolean,
  token: symbol,
): Promise<void> => {
  if (latestChangeToken.get(changeMapKey(bucket, key)) !== token) return
  await queryClient.cancelQueries({ queryKey: tagQueryKey(bucket, key) })
  queryClient.setQueryData(tagQueryKey(bucket, key), isPublic)
}

// The latest-issued change failing doesn't mean the cache still holds the
// right value: an earlier change may already have succeeded server-side
// while its own applyPublicState call lost the token race above. Refetching
// reconciles the cache with server truth instead of leaving it on a value
// neither change actually applied.
export const revertPublicStateOnFailure = async (
  queryClient: QueryClient,
  bucket: string,
  key: string,
  token: symbol,
): Promise<void> => {
  if (latestChangeToken.get(changeMapKey(bucket, key)) !== token) return
  await queryClient.invalidateQueries({ queryKey: tagQueryKey(bucket, key) })
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
