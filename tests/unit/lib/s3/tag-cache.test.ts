import { QueryClient } from "@tanstack/react-query"
import { delay, http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import { applyPublicState, beginPublicStateChange, revertPublicStateOnFailure, tagQueryKey, tagQueryOptions } from "~/lib/s3/tag-cache"

import { TEST_S3_ENDPOINT as ENDPOINT,testS3 } from "../../_helpers/s3"
import { getObjectTaggingXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const BUCKET = "kura-tester"

describe("applyPublicState", () => {
  test("applyPublicState_inFlightStaleFetch_doesNotOverwriteNewState", async () => {
    // A tag fetch leaves before the publish and would answer "private" after
    // it; the publish outcome must win.
    server.use(http.get(`${ENDPOINT}/${BUCKET}/a.txt`, async () => {
      await delay(200)
      return HttpResponse.xml(getObjectTaggingXml([]))
    }))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    const staleFetch = queryClient
      .fetchQuery(tagQueryOptions(testS3(), BUCKET, "a.txt"))
      .catch(() => undefined)
    const token = beginPublicStateChange(BUCKET, "a.txt")
    await applyPublicState(queryClient, BUCKET, "a.txt", true, token)
    await staleFetch
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(queryClient.getQueryData(tagQueryKey(BUCKET, "a.txt"))).toBe(true)
    queryClient.clear()
  })

  test("applyPublicState_supersededByNewerChange_isIgnored", async () => {
    // publish (tokenA) is issued, then unpublish (tokenB) is issued for the
    // same key; unpublish's response arrives first, publish's arrives late.
    // The last-issued change (tokenB, false) must win either way.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const tokenA = beginPublicStateChange(BUCKET, "a.txt")
    const tokenB = beginPublicStateChange(BUCKET, "a.txt")

    await applyPublicState(queryClient, BUCKET, "a.txt", false, tokenB)
    await applyPublicState(queryClient, BUCKET, "a.txt", true, tokenA)

    expect(queryClient.getQueryData(tagQueryKey(BUCKET, "a.txt"))).toBe(false)
    queryClient.clear()
  })
})

describe("revertPublicStateOnFailure", () => {
  test("revertPublicStateOnFailure_latestToken_invalidatesCache", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const token = beginPublicStateChange(BUCKET, "a.txt")
    queryClient.setQueryData(tagQueryKey(BUCKET, "a.txt"), true)

    await revertPublicStateOnFailure(queryClient, BUCKET, "a.txt", token)

    expect(queryClient.getQueryState(tagQueryKey(BUCKET, "a.txt"))?.isInvalidated).toBe(true)
    queryClient.clear()
  })

  test("revertPublicStateOnFailure_supersededByNewerChange_isIgnored", async () => {
    // An earlier change (tokenA) fails after a later change (tokenB) already
    // succeeded; tokenB's cached result must survive tokenA's failure.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const tokenA = beginPublicStateChange(BUCKET, "a.txt")
    const tokenB = beginPublicStateChange(BUCKET, "a.txt")
    await applyPublicState(queryClient, BUCKET, "a.txt", false, tokenB)

    await revertPublicStateOnFailure(queryClient, BUCKET, "a.txt", tokenA)

    expect(queryClient.getQueryState(tagQueryKey(BUCKET, "a.txt"))?.isInvalidated).toBe(false)
    expect(queryClient.getQueryData(tagQueryKey(BUCKET, "a.txt"))).toBe(false)
    queryClient.clear()
  })
})
