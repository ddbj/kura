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
    expect(tr?.error).toContain("1 件")
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
    expect(deleted.sort()).toEqual(["old/a.txt", "old/sub/b.txt"])
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
    expect(outcome?.failed.map((f) => f.key)).toEqual(["old/bad.txt"])
    const tr = result.current.t.transfers[0]
    expect(tr?.state).toBe("failed")
    expect(tr?.error).toContain("1 件")
  })
})
