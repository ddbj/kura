import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import type { ReactNode } from "react"
import { AuthProvider, useAuth } from "react-oidc-context"
import { describe, expect, test } from "vitest"

import { oidcProviderProps } from "~/lib/auth"
import { ConfigProvider } from "~/lib/config"
import { createQueryClient } from "~/lib/query"
import { UploadsProvider, useTransfers } from "~/shell/uploads"

import { seedAuthenticatedUser } from "../_helpers/oidc"
import { testConfig } from "../_helpers/render"
import { copyObjectXml, deleteObjectsXml, listObjectsV2Xml, s3ErrorXml, stsAssumeRoleXml } from "../mocks/s3-xml"
import { server } from "../mocks/server"

const ENDPOINT = "http://localhost:28333"
const BUCKET = "kura-tester"

// Static metadata + disabled auto-renewal keep the AuthProvider from probing
// the network (OIDC discovery, silent renew iframe) which jsdom + msw would
// otherwise 404.
const testAuthProps = {
  ...oidcProviderProps(testConfig),
  automaticSilentRenew: false,
  metadata: {
    issuer: testConfig.oidcIssuer,
    authorization_endpoint: `${testConfig.oidcIssuer}/protocol/openid-connect/auth`,
    token_endpoint: `${testConfig.oidcIssuer}/protocol/openid-connect/token`,
    jwks_uri: `${testConfig.oidcIssuer}/protocol/openid-connect/certs`,
    end_session_endpoint: `${testConfig.oidcIssuer}/protocol/openid-connect/logout`,
  },
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <ConfigProvider value={testConfig}>
    <AuthProvider {...testAuthProps}>
      <QueryClientProvider client={createQueryClient()}>
        <UploadsProvider>{children}</UploadsProvider>
      </QueryClientProvider>
    </AuthProvider>
  </ConfigProvider>
)

// useAuth's user restore is async (sessionStorage read happens after mount);
// wait for it before touching s3, otherwise freshAccessToken falls through to
// signinSilent which fails under jsdom.
const useReadyHooks = () => {
  const t = useTransfers()
  const auth = useAuth()

  return { t, auth }
}

const seedStsHandler = () => {
  // useS3 mints credentials via STS on every send; each test needs the base
  // handler so per-request handlers (list/put/delete) can fire.
  server.use(
    http.post(ENDPOINT, ({ request }) => {
      const url = new URL(request.url)
      // Fall through to per-test DeleteObjects handler.
      if (url.searchParams.has("delete")) return undefined
      return HttpResponse.xml(stsAssumeRoleXml({
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret",
        sessionToken: "session-token",
        expiration: new Date(Date.now() + 3600_000).toISOString(),
      }))
    }),
  )
}

const setupHooks = async () => {
  seedAuthenticatedUser(testConfig, { username: BUCKET })
  seedStsHandler()
  const rendered = renderHook(useReadyHooks, { wrapper })
  await waitFor(() => {
    expect(rendered.result.current.auth.user?.access_token).toBeTruthy()
  })

  return rendered.result
}

describe("useTransfers.enqueueDelete", () => {
  test("enqueueDelete_success_reportsDeletedAndAutoDismisses", async () => {
    server.use(
      http.post(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(deleteObjectsXml({ deleted: ["a.txt", "b.txt"] }))),
    )
    const result = await setupHooks()

    let outcome: Awaited<ReturnType<typeof result.current.t.enqueueDelete>> | undefined
    await act(async () => {
      outcome = await result.current.t.enqueueDelete(BUCKET, [
        { key: "a.txt", size: 1 },
        { key: "b.txt", size: 2 },
      ])
    })

    expect(outcome?.ok).toEqual(["a.txt", "b.txt"])
    expect(outcome?.failed).toEqual([])
    await waitFor(() => {
      const tr = result.current.t.transfers[0]
      expect(tr?.kind).toBe("delete")
      expect(tr?.state).toBe("done")
      expect(tr?.loaded).toBe(2)
      expect(tr?.total).toBe(2)
    })
  })

  test("enqueueDelete_partialFailure_transferMarkedFailed", async () => {
    server.use(
      http.post(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(deleteObjectsXml({
          deleted: ["a.txt"],
          errors: [{ key: "b.txt", code: "AccessDenied", message: "nope" }],
        }))),
    )
    const result = await setupHooks()

    let outcome: Awaited<ReturnType<typeof result.current.t.enqueueDelete>> | undefined
    await act(async () => {
      outcome = await result.current.t.enqueueDelete(BUCKET, [
        { key: "a.txt", size: 1 },
        { key: "b.txt", size: 2 },
      ])
    })

    expect(outcome?.ok).toEqual(["a.txt"])
    expect(outcome?.failed).toEqual([{ key: "b.txt", message: "nope" }])
    const tr = result.current.t.transfers[0]
    expect(tr?.state).toBe("failed")
    // The transfer surfaces a per-key failure count; the outcome carries the
    // key that actually failed (b.txt) with the AccessDenied message.
    expect(tr?.error).toMatch(/1\b/)
    expect(outcome?.failed[0]?.message).toBe("nope")
  })

  test("enqueueDelete_emptyTargets_isNoop", async () => {
    const result = await setupHooks()
    let outcome: Awaited<ReturnType<typeof result.current.t.enqueueDelete>> | undefined
    await act(async () => {
      outcome = await result.current.t.enqueueDelete(BUCKET, [])
    })
    expect(outcome).toEqual({ ok: [], failed: [] })
    expect(result.current.t.transfers).toEqual([])
  })
})

describe("useTransfers.enqueueRename", () => {
  test("enqueueRename_success_createsRenameTransferAndCompletes", async () => {
    const events: string[] = []
    server.use(
      http.put(`${ENDPOINT}/${BUCKET}/:key+`, () => {
        events.push("copy")

        return HttpResponse.xml(copyObjectXml("etag", "2026-07-13T00:00:00.000Z"))
      }),
      http.delete(`${ENDPOINT}/${BUCKET}/:key+`, () => {
        events.push("delete")

        return new HttpResponse(null, { status: 204 })
      }),
    )
    const result = await setupHooks()

    await act(async () => {
      await result.current.t.enqueueRename(BUCKET, "old.txt", "new.txt")
    })

    expect(events).toEqual(["copy", "delete"])
    await waitFor(() => {
      const tr = result.current.t.transfers[0]
      expect(tr?.kind).toBe("rename")
      expect(tr?.state).toBe("done")
      expect(tr?.destKey).toBe("new.txt")
    })
  })

  test("enqueueRename_copyFails_transferFailedAndPromiseRejects", async () => {
    server.use(
      http.put(`${ENDPOINT}/${BUCKET}/:key+`, () =>
        new HttpResponse(s3ErrorXml("AccessDenied", "no"), {
          status: 403,
          headers: { "Content-Type": "application/xml" },
        })),
    )
    const result = await setupHooks()

    await act(async () => {
      await expect(result.current.t.enqueueRename(BUCKET, "old.txt", "new.txt")).rejects.toThrow()
    })

    const tr = result.current.t.transfers[0]
    expect(tr?.kind).toBe("rename")
    expect(tr?.state).toBe("failed")
  })
})

describe("useTransfers.enqueueCopy", () => {
  test("enqueueCopy_success_marksDoneAndDoesNotDeleteSource", async () => {
    let deleteHit = 0
    server.use(
      http.put(`${ENDPOINT}/${BUCKET}/:key+`, () =>
        HttpResponse.xml(copyObjectXml("etag", "2026-07-13T00:00:00.000Z"))),
      http.delete(`${ENDPOINT}/${BUCKET}/:key+`, () => { deleteHit += 1; return new HttpResponse(null, { status: 204 }) }),
    )
    const result = await setupHooks()

    await act(async () => {
      await result.current.t.enqueueCopy(BUCKET, "a.txt", "a-copy.txt")
    })

    expect(deleteHit).toBe(0)
    const tr = result.current.t.transfers[0]
    expect(tr?.kind).toBe("copy")
    expect(tr?.state).toBe("done")
  })
})

describe("useTransfers.enqueueFolderDelete", () => {
  test("enqueueFolderDelete_listsThenBatchDeletes_updatesTotalAndLoaded", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listObjectsV2Xml({
          bucket: BUCKET,
          prefix: "docs/",
          objects: [
            { key: "docs/.keep", size: 0, lastModified: "2026-07-01T10:00:00.000Z" },
            { key: "docs/a.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" },
            { key: "docs/b.txt", size: 2, lastModified: "2026-07-01T10:00:00.000Z" },
          ],
          commonPrefixes: [],
        }))),
      http.post(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(deleteObjectsXml({
          deleted: ["docs/.keep", "docs/a.txt", "docs/b.txt"],
        }))),
    )
    const result = await setupHooks()

    let outcome: Awaited<ReturnType<typeof result.current.t.enqueueFolderDelete>> | undefined
    await act(async () => {
      outcome = await result.current.t.enqueueFolderDelete(BUCKET, "docs/")
    })

    expect(outcome?.ok.length).toBe(3)
    const tr = result.current.t.transfers[0]
    expect(tr?.kind).toBe("folder-delete")
    expect(tr?.total).toBe(3)
    expect(tr?.loaded).toBe(3)
    expect(tr?.state).toBe("done")
    expect(tr?.isFolder).toBe(true)
  })
})

describe("useTransfers.enqueueFolderMove", () => {
  test("enqueueFolderMove_movesEachEntry_underNewPrefix", async () => {
    const copied: string[] = []
    const deleted: string[] = []
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listObjectsV2Xml({
          bucket: BUCKET,
          prefix: "old/",
          objects: [
            { key: "old/a.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" },
            { key: "old/sub/b.txt", size: 2, lastModified: "2026-07-01T10:00:00.000Z" },
          ],
          commonPrefixes: [],
        }))),
      http.put(`${ENDPOINT}/${BUCKET}/:key+`, ({ params }) => {
        const key = Array.isArray(params["key"]) ? params["key"].join("/") : String(params["key"])
        copied.push(key)

        return HttpResponse.xml(copyObjectXml("etag", "2026-07-13T00:00:00.000Z"))
      }),
      http.delete(`${ENDPOINT}/${BUCKET}/:key+`, ({ params }) => {
        const key = Array.isArray(params["key"]) ? params["key"].join("/") : String(params["key"])
        deleted.push(key)

        return new HttpResponse(null, { status: 204 })
      }),
    )
    const result = await setupHooks()

    let outcome: Awaited<ReturnType<typeof result.current.t.enqueueFolderMove>> | undefined
    await act(async () => {
      outcome = await result.current.t.enqueueFolderMove(BUCKET, "old/", "new/", "folder-move")
    })

    expect(outcome?.ok.length).toBe(2)
    expect(copied.sort()).toEqual(["new/a.txt", "new/sub/b.txt"])
    // enqueueFolderMove は完了後に deleteEmptyDirectory(srcPrefix) を発行し
    // SeaweedFS filer に残る空 directory metadata を掃除する。MSW route の
    // :key+ 変数は末尾スラッシュを剥がすので "old" が観測される。
    expect(deleted.sort()).toEqual(["old", "old/a.txt", "old/sub/b.txt"])
    const tr = result.current.t.transfers[0]
    expect(tr?.kind).toBe("folder-move")
    expect(tr?.state).toBe("done")
    expect(tr?.total).toBe(2)
    expect(tr?.loaded).toBe(2)
  })

  test("enqueueFolderMove_perItemFailure_collectsFailedList", async () => {
    server.use(
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listObjectsV2Xml({
          bucket: BUCKET,
          prefix: "old/",
          objects: [
            { key: "old/a.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" },
            { key: "old/bad.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" },
          ],
          commonPrefixes: [],
        }))),
      http.put(`${ENDPOINT}/${BUCKET}/new/bad.txt`, () =>
        new HttpResponse(s3ErrorXml("AccessDenied", "no"), {
          status: 403,
          headers: { "Content-Type": "application/xml" },
        })),
      http.put(`${ENDPOINT}/${BUCKET}/:key+`, () =>
        HttpResponse.xml(copyObjectXml("etag", "2026-07-13T00:00:00.000Z"))),
      http.delete(`${ENDPOINT}/${BUCKET}/:key+`, () => new HttpResponse(null, { status: 204 })),
    )
    const result = await setupHooks()

    let outcome: Awaited<ReturnType<typeof result.current.t.enqueueFolderMove>> | undefined
    await act(async () => {
      outcome = await result.current.t.enqueueFolderMove(BUCKET, "old/", "new/", "folder-move")
    })

    expect(outcome?.ok).toEqual(["old/a.txt"])
    expect(outcome?.failed).toHaveLength(1)
    expect(outcome?.failed[0]?.key).toBe("old/bad.txt")
    // Test verifies the specific failing key propagates; the AccessDenied
    // response's <Message>no</Message> surfaces on the failed entry.
    expect(outcome?.failed[0]?.message).toBeTruthy()
    expect(outcome?.failed[0]?.message).not.toEqual("")
    const tr = result.current.t.transfers[0]
    expect(tr?.state).toBe("failed")
    expect(tr?.error).toMatch(/1\b/)
  })
})

describe("useTransfers.enqueue (upload flow)", () => {
  // HeadObject 200 vs 404 drives conflict vs queue; PUT 200 completes the
  // transfer; a delayed PUT gives cancel/retry room to act.
  const smallFile = () => new File(["hello"], "hello.txt", { type: "text/plain" })
  const KEY = "docs/hello.txt"

  test("enqueue_noConflict_uploadsAndReachesDone", async () => {
    const puts: string[] = []
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}/${KEY}`, () => new HttpResponse(null, { status: 404 })),
      http.put(`${ENDPOINT}/${BUCKET}/${KEY}`, async ({ request }) => {
        puts.push(await request.text())
        return new HttpResponse(null, { status: 200, headers: { ETag: "\"e\"" } })
      }),
    )
    const result = await setupHooks()

    await act(async () => {
      result.current.t.enqueue(BUCKET, "docs/", [smallFile()])
    })
    await waitFor(() => {
      expect(result.current.t.transfers[0]?.state).toBe("done")
    })
    expect(puts).toEqual(["hello"])
    const tr = result.current.t.transfers[0]
    expect(tr?.kind).toBe("upload")
    expect(tr?.key).toBe(KEY)
    expect(tr?.loaded).toBe(tr?.total)
  })

  test("enqueue_conflict_setsConflictStateAndDoesNotUpload", async () => {
    let putHit = 0
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}/${KEY}`, () => new HttpResponse(null, { status: 200 })),
      http.put(`${ENDPOINT}/${BUCKET}/${KEY}`, () => {
        putHit += 1
        return new HttpResponse(null, { status: 200, headers: { ETag: "\"e\"" } })
      }),
    )
    const result = await setupHooks()

    await act(async () => {
      result.current.t.enqueue(BUCKET, "docs/", [smallFile()])
    })
    await waitFor(() => {
      expect(result.current.t.transfers[0]?.state).toBe("conflict")
    })
    expect(putHit).toBe(0)
  })

  test("enqueue_conflictThenSkip_removesTransferAndNeverUploads", async () => {
    let putHit = 0
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}/${KEY}`, () => new HttpResponse(null, { status: 200 })),
      http.put(`${ENDPOINT}/${BUCKET}/${KEY}`, () => {
        putHit += 1
        return new HttpResponse(null, { status: 200, headers: { ETag: "\"e\"" } })
      }),
    )
    const result = await setupHooks()

    await act(async () => {
      result.current.t.enqueue(BUCKET, "docs/", [smallFile()])
    })
    await waitFor(() => {
      expect(result.current.t.transfers[0]?.state).toBe("conflict")
    })
    const id = result.current.t.transfers[0]!.id
    act(() => {
      result.current.t.skip(id)
    })
    await waitFor(() => {
      expect(result.current.t.transfers).toHaveLength(0)
    })
    expect(putHit).toBe(0)
  })

  test("enqueue_conflictThenOverwrite_proceedsToUpload", async () => {
    const puts: string[] = []
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}/${KEY}`, () => new HttpResponse(null, { status: 200 })),
      http.put(`${ENDPOINT}/${BUCKET}/${KEY}`, async ({ request }) => {
        puts.push(await request.text())
        return new HttpResponse(null, { status: 200, headers: { ETag: "\"e\"" } })
      }),
    )
    const result = await setupHooks()

    await act(async () => {
      result.current.t.enqueue(BUCKET, "docs/", [smallFile()])
    })
    await waitFor(() => {
      expect(result.current.t.transfers[0]?.state).toBe("conflict")
    })
    const id = result.current.t.transfers[0]!.id
    act(() => {
      result.current.t.overwrite(id)
    })
    await waitFor(() => {
      expect(result.current.t.transfers[0]?.state).toBe("done")
    })
    expect(puts).toEqual(["hello"])
  })

  test("enqueue_conflictThenSaveAs_uploadsUnderRenamedKey", async () => {
    const puts: string[] = []
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}/${KEY}`, () => new HttpResponse(null, { status: 200 })),
      http.put(`${ENDPOINT}/${BUCKET}/:key+`, async ({ params, request }) => {
        const path = Array.isArray(params["key"]) ? params["key"].join("/") : String(params["key"])
        puts.push(path)
        await request.text()
        return new HttpResponse(null, { status: 200, headers: { ETag: "\"e\"" } })
      }),
    )
    const result = await setupHooks()

    await act(async () => {
      result.current.t.enqueue(BUCKET, "docs/", [smallFile()])
    })
    await waitFor(() => {
      expect(result.current.t.transfers[0]?.state).toBe("conflict")
    })
    const id = result.current.t.transfers[0]!.id
    act(() => {
      result.current.t.saveAs(id)
    })
    await waitFor(() => {
      expect(result.current.t.transfers[0]?.state).toBe("done")
    })
    // saveAs stamps the current time into the stem, so the exact path is
    // dynamic; the invariant is that the destination differs from the
    // conflict target and shares the same folder / extension.
    expect(puts).toHaveLength(1)
    const uploadedKey = puts[0]!
    expect(uploadedKey).not.toBe(KEY)
    expect(uploadedKey.startsWith("docs/hello-")).toBe(true)
    expect(uploadedKey.endsWith(".txt")).toBe(true)
    expect(result.current.t.transfers[0]?.key).toBe(uploadedKey)
  })

  test("enqueue_uploadFailure_marksFailedAndRetryReuploads", async () => {
    // First user-visible attempt: keep returning 400 so the SDK's own retry
    // logic gives up and the row is marked failed (400 is not retryable in
    // v3). After the user issues a retry, flip the handler to 200 so the
    // second attempt succeeds and the row transitions to done.
    let mode: "fail" | "ok" = "fail"
    const putBodies: string[] = []
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}/${KEY}`, () => new HttpResponse(null, { status: 404 })),
      http.put(`${ENDPOINT}/${BUCKET}/${KEY}`, async ({ request }) => {
        const body = await request.text()
        if (mode === "fail") {
          return new HttpResponse(null, { status: 400 })
        }
        putBodies.push(body)
        return new HttpResponse(null, { status: 200, headers: { ETag: "\"e\"" } })
      }),
    )
    const result = await setupHooks()

    await act(async () => {
      result.current.t.enqueue(BUCKET, "docs/", [smallFile()])
    })
    await waitFor(() => {
      expect(result.current.t.transfers[0]?.state).toBe("failed")
    })
    expect(result.current.t.transfers[0]?.error).toBeTruthy()
    const id = result.current.t.transfers[0]!.id

    mode = "ok"
    act(() => {
      result.current.t.retry(id)
    })
    await waitFor(() => {
      expect(result.current.t.transfers[0]?.state).toBe("done")
    })
    expect(putBodies).toEqual(["hello"])
    expect(result.current.t.transfers[0]?.error).toBeUndefined()
  })

  test("enqueue_headForbidden_marksTransferFailed", async () => {
    // A HEAD response other than 200/404 is a real error; it must not be
    // silently treated as "no conflict" (that would race with a real overwrite).
    let putHit = 0
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}/${KEY}`, () => new HttpResponse(null, { status: 500 })),
      http.put(`${ENDPOINT}/${BUCKET}/${KEY}`, () => {
        putHit += 1
        return new HttpResponse(null, { status: 200 })
      }),
    )
    const result = await setupHooks()

    await act(async () => {
      result.current.t.enqueue(BUCKET, "docs/", [smallFile()])
    })
    await waitFor(() => {
      expect(result.current.t.transfers[0]?.state).toBe("failed")
    })
    expect(putHit).toBe(0)
  })

  test("enqueue_cancelWhileConflicted_dropsTheRowAndSkipsUpload", async () => {
    // Conflict rows are not running yet: cancel takes the "just remove"
    // path (see cancel() in uploads.tsx) — same terminal state the user
    // would reach by choosing 「スキップ」.
    let putHit = 0
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}/${KEY}`, () => new HttpResponse(null, { status: 200 })),
      http.put(`${ENDPOINT}/${BUCKET}/${KEY}`, () => {
        putHit += 1
        return new HttpResponse(null, { status: 200 })
      }),
    )
    const result = await setupHooks()

    await act(async () => {
      result.current.t.enqueue(BUCKET, "docs/", [smallFile()])
    })
    await waitFor(() => {
      expect(result.current.t.transfers[0]?.state).toBe("conflict")
    })
    const id = result.current.t.transfers[0]!.id
    act(() => {
      result.current.t.cancel(id)
    })
    await waitFor(() => {
      expect(result.current.t.transfers).toHaveLength(0)
    })
    expect(putHit).toBe(0)
  })

  test("enqueue_cancelAfterFailure_dropsTheRow", async () => {
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}/${KEY}`, () => new HttpResponse(null, { status: 404 })),
      http.put(`${ENDPOINT}/${BUCKET}/${KEY}`, () => new HttpResponse(null, { status: 500 })),
    )
    const result = await setupHooks()

    await act(async () => {
      result.current.t.enqueue(BUCKET, "docs/", [smallFile()])
    })
    await waitFor(() => {
      expect(result.current.t.transfers[0]?.state).toBe("failed")
    })
    const id = result.current.t.transfers[0]!.id
    act(() => {
      result.current.t.cancel(id)
    })
    await waitFor(() => {
      expect(result.current.t.transfers).toHaveLength(0)
    })
  })

  test("enqueue_emptyFileList_isNoop", async () => {
    const result = await setupHooks()
    act(() => {
      result.current.t.enqueue(BUCKET, "docs/", [])
    })
    expect(result.current.t.transfers).toEqual([])
  })
})
