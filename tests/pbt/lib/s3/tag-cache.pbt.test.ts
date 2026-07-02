import { fc, test } from "@fast-check/vitest"
import { QueryClient } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { afterAll, beforeAll, describe, expect } from "vitest"

import { createS3Client } from "~/lib/s3/client"
import { applyPublicState, tagQueryKey, tagQueryOptions } from "~/lib/s3/tag-cache"
import { publishObject, unpublishObject } from "~/lib/s3/tags"

import { getObjectTaggingXml } from "../../../unit/mocks/s3-xml"

const ENDPOINT = "http://localhost:28333"
const BUCKET = "kura-tester"
const KEYS = ["a.txt", "docs/b.txt", "日本語 メモ.md"] as const

// run ごとに差し替えられる仮想サーバ状態 (公開 = true)。handler は 1 度だけ
// 登録し、クロージャ経由でこの変数を参照する。
let store = new Map<string, boolean>()

const keyOf = (params: Record<string, string | readonly string[] | undefined>): string => {
  const key = params["key"]

  return Array.isArray(key) ? key.join("/") : String(key)
}

const server = setupServer(
  http.get(`${ENDPOINT}/${BUCKET}/:key+`, ({ params }) =>
    HttpResponse.xml(getObjectTaggingXml(
      store.get(keyOf(params)) === true ? [{ key: "kura-public", value: "true" }] : [],
    ))),
  http.put(`${ENDPOINT}/${BUCKET}/:key+`, ({ params }) => {
    store.set(keyOf(params), true)

    return new HttpResponse(null, { status: 200 })
  }),
  http.delete(`${ENDPOINT}/${BUCKET}/:key+`, ({ params }) => {
    store.set(keyOf(params), false)

    return new HttpResponse(null, { status: 204 })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterAll(() => server.close())

const s3 = createS3Client(ENDPOINT, () => Promise.resolve({
  accessKeyId: "AKIATEST",
  secretAccessKey: "secret",
  sessionToken: "session-token",
  expiration: new Date(Date.now() + 3600_000),
}))

type Op =
  | { op: "fetch"; keys: string[] }
  | { op: "publish"; key: string }
  | { op: "unpublish"; key: string }
  | { op: "invalidateAll" }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant("fetch" as const), keys: fc.subarray([...KEYS]) }),
  fc.record({ op: fc.constant("publish" as const), key: fc.constantFrom(...KEYS) }),
  fc.record({ op: fc.constant("unpublish" as const), key: fc.constantFrom(...KEYS) }),
  fc.record({ op: fc.constant("invalidateAll" as const) }),
)

const applyOp = async (queryClient: QueryClient, op: Op): Promise<void> => {
  switch (op.op) {
    case "fetch":
      await Promise.all(op.keys.map((key) => queryClient.fetchQuery(tagQueryOptions(s3, BUCKET, key))))
      break
    case "publish":
      await publishObject(s3, BUCKET, op.key)
      await applyPublicState(queryClient, BUCKET, op.key, true)
      break
    case "unpublish":
      await unpublishObject(s3, BUCKET, op.key)
      await applyPublicState(queryClient, BUCKET, op.key, false)
      break
    case "invalidateAll":
      await queryClient.invalidateQueries({ queryKey: ["tag", BUCKET] })
      break
  }
}

describe("tag cache properties", () => {
  // 不変条件: SPA 経由の操作だけが起きる限り、キャッシュに載っている公開フラグは
  // 常にサーバの状態と一致する (未取得 = undefined は許される)。
  test.prop([fc.array(opArb, { maxLength: 12 })], { numRuns: 30 })(
    "tagCache_afterAnySequentialOps_cachedFlagsMatchServer",
    async (ops) => {
      store = new Map()
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })

      for (const op of ops) {
        await applyOp(queryClient, op)
        for (const key of KEYS) {
          const cached = queryClient.getQueryData<boolean>(tagQueryKey(BUCKET, key))
          if (cached !== undefined) {
            expect(cached).toBe(store.get(key) ?? false)
          }
        }
      }
      queryClient.clear()
    },
  )
})
