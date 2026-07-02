import { QueryClient } from "@tanstack/react-query"
import { delay, http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import { applyPublicState, tagQueryKey, tagQueryOptions } from "~/lib/s3/tag-cache"

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
    await applyPublicState(queryClient, BUCKET, "a.txt", true)
    await staleFetch
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(queryClient.getQueryData(tagQueryKey(BUCKET, "a.txt"))).toBe(true)
    queryClient.clear()
  })
})
