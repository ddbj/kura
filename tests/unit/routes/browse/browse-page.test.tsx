import { screen, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { describe, expect, test, vi } from "vitest"

import type { AppConfig } from "~/lib/config"
import { BrowsePage } from "~/routes/browse/browse-page"

import { seedAuthenticatedUser } from "../../_helpers/oidc"
import { renderWithStub, testConfig } from "../../_helpers/render"
import { getObjectTaggingXml, listObjectsV2Xml, stsAssumeRoleXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const ENDPOINT = testConfig.s3Endpoint
const BUCKET = "kura-tester"

type ListedObject = { key: string; size: number; lastModified: string }

const paramKey = (params: Record<string, string | readonly string[] | undefined>): string => {
  const key = params["key"]

  return Array.isArray(key) ? key.join("/") : String(key)
}

const stubBucket = ({ objects = [], commonPrefixes = [], prefix = "", publicKeys = [] }: {
  objects?: ListedObject[]
  commonPrefixes?: string[]
  prefix?: string
  publicKeys?: string[]
} = {}) => {
  const deleted: string[] = []
  server.use(
    http.head(`${ENDPOINT}/${BUCKET}`, () => new HttpResponse(null, { status: 200 })),
    http.get(`${ENDPOINT}/${BUCKET}`, () =>
      HttpResponse.xml(listObjectsV2Xml({ bucket: BUCKET, prefix, objects, commonPrefixes }))),
    // The browse view lazily fetches ?tagging per visible object.
    http.get(`${ENDPOINT}/${BUCKET}/:key+`, ({ params }) =>
      HttpResponse.xml(getObjectTaggingXml(
        publicKeys.includes(paramKey(params)) ? [{ key: "kura-public", value: "true" }] : [],
      ))),
    http.delete(`${ENDPOINT}/${BUCKET}/:key+`, ({ params }) => {
      deleted.push(paramKey(params))
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return deleted
}

const stubSts = () =>
  server.use(
    http.post(`${ENDPOINT}/`, () =>
      HttpResponse.xml(stsAssumeRoleXml({
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret",
        sessionToken: "session-token",
        expiration: new Date(Date.now() + 3600_000).toISOString(),
      }))),
  )

const renderBrowse = (prefix = "", config: AppConfig = testConfig) => {
  stubSts()
  seedAuthenticatedUser(config, { username: BUCKET })
  return renderWithStub({
    routes: [
      { path: "/", Component: () => <BrowsePage prefix={prefix} /> },
      { path: "/_browse/*", Component: () => <p>navigated-to-splat</p> },
    ],
    initialEntries: ["/"],
    config,
  })
}

describe("BrowsePage", () => {
  test("BrowsePage_listsFilesAndDirs", async () => {
    stubBucket({
      objects: [{ key: "報告書 2026.pdf", size: 2048, lastModified: "2026-07-01T10:00:00.000Z" }],
      commonPrefixes: ["docs/"],
    })
    renderBrowse()
    expect(await screen.findByText("報告書 2026.pdf")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /docs/ })).toHaveAttribute("href", "/_browse/docs")
    expect(screen.getByText("2.0 KiB")).toBeInTheDocument()
  })

  test("BrowsePage_emptyBucket_showsEmptyState", async () => {
    stubBucket()
    renderBrowse()
    expect(await screen.findByText("ファイルはまだありません。")).toBeInTheDocument()
  })

  test("BrowsePage_missingBucket_isCreatedThenListed", async () => {
    const created: string[] = []
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}`, () => new HttpResponse(null, { status: 404 })),
      http.put(`${ENDPOINT}/${BUCKET}`, () => {
        created.push(BUCKET)
        return new HttpResponse(null, { status: 200 })
      }),
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listObjectsV2Xml({ bucket: BUCKET, prefix: "", objects: [], commonPrefixes: [] }))),
    )
    renderBrowse()
    expect(await screen.findByText("ファイルはまだありません。")).toBeInTheDocument()
    expect(created).toEqual([BUCKET])
  })

  test("BrowsePage_breadcrumb_linksToAncestors", async () => {
    stubBucket({ prefix: "docs/sub/" })
    renderBrowse("docs/sub/")
    const breadcrumb = await screen.findByRole("navigation", { name: /パス/ })
    expect(within(breadcrumb).getByRole("link", { name: "ホーム" })).toHaveAttribute("href", "/")
    expect(within(breadcrumb).getByRole("link", { name: "docs" })).toHaveAttribute("href", "/_browse/docs")
    expect(within(breadcrumb).getByText("sub")).toBeInTheDocument()
  })

  test("BrowsePage_deleteFlow_confirmsThenDeletes", async () => {
    const user = userEvent.setup()
    const deleted = stubBucket({
      objects: [{ key: "old.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" }],
    })
    renderBrowse()
    await user.click(await screen.findByRole("button", { name: "削除" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/old\.txt/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "削除" }))
    await vi.waitFor(() => expect(deleted).toEqual(["old.txt"]))
  })

  test("BrowsePage_deleteCancelled_doesNotDelete", async () => {
    const user = userEvent.setup()
    const deleted = stubBucket({
      objects: [{ key: "keep.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" }],
    })
    renderBrowse()
    await user.click(await screen.findByRole("button", { name: "削除" }))
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "キャンセル" }))
    expect(deleted).toEqual([])
    expect(screen.getByText("keep.txt")).toBeInTheDocument()
  })

  test("BrowsePage_download_opensPresignedUrl", async () => {
    const user = userEvent.setup()
    stubBucket({
      objects: [{ key: "data.bin", size: 10, lastModified: "2026-07-01T10:00:00.000Z" }],
    })
    const clicked: string[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.href)
    })
    try {
      renderBrowse()
      await user.click(await screen.findByRole("button", { name: "ダウンロード" }))
      await vi.waitFor(() => expect(clicked).toHaveLength(1))
      const url = new URL(clicked[0] ?? "")
      expect(url.origin).toBe(ENDPOINT)
      expect(url.pathname).toBe(`/${BUCKET}/data.bin`)
      expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy()
    } finally {
      clickSpy.mockRestore()
    }
  })

  test("BrowsePage_publicBadge_shownOnlyForTaggedObjects", async () => {
    stubBucket({
      objects: [
        { key: "pub.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" },
        { key: "priv.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" },
      ],
      publicKeys: ["pub.txt"],
    })
    renderBrowse()

    const pubRow = (await screen.findByRole("cell", { name: /pub\.txt/ })).closest("tr")!
    await vi.waitFor(() => expect(within(pubRow).getByText("公開中")).toBeInTheDocument())
    const privRow = screen.getByRole("cell", { name: "priv.txt" }).closest("tr")!
    expect(within(privRow).queryByText("公開中")).not.toBeInTheDocument()
  })

  test("BrowsePage_publishFlow_showsUrlAndUpdatesBadge", async () => {
    const user = userEvent.setup()
    stubBucket({ objects: [{ key: "doc.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" }] })
    const taggingPuts: string[] = []
    server.use(http.put(`${ENDPOINT}/${BUCKET}/:key+`, async ({ request }) => {
      expect(new URL(request.url).searchParams.has("tagging")).toBe(true)
      taggingPuts.push(await request.text())
      return new HttpResponse(null, { status: 200 })
    }))
    renderBrowse()

    await user.click(await screen.findByRole("button", { name: "公開" }))
    const dialog = await screen.findByRole("dialog")
    const url = `${testConfig.publicBase}/${BUCKET}/doc.txt`
    expect(within(dialog).getByText(url)).toBeInTheDocument()

    await user.click(within(dialog).getByRole("button", { name: "公開する" }))
    expect(await within(dialog).findByRole("textbox", { name: "公開 URL" })).toHaveValue(url)
    expect(taggingPuts[0]).toContain("<Key>kura-public</Key>")
    expect(await screen.findByText("公開中")).toBeInTheDocument()
  })

  test("BrowsePage_unpublishFlow_removesBadge", async () => {
    const user = userEvent.setup()
    stubBucket({
      objects: [{ key: "pub.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" }],
      publicKeys: ["pub.txt"],
    })
    const taggingDeletes: string[] = []
    server.use(http.delete(`${ENDPOINT}/${BUCKET}/:key+`, ({ request, params }) => {
      expect(new URL(request.url).searchParams.has("tagging")).toBe(true)
      taggingDeletes.push(paramKey(params))
      return new HttpResponse(null, { status: 204 })
    }))
    renderBrowse()
    expect(await screen.findByText("公開中")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "公開" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "公開停止" }))

    await vi.waitFor(() => expect(taggingDeletes).toEqual(["pub.txt"]))
    await vi.waitFor(() => expect(screen.queryByText("公開中")).not.toBeInTheDocument())
    expect(within(dialog).getByRole("button", { name: "公開する" })).toBeInTheDocument()
  })

  test("BrowsePage_shareFlow_issuesPresignedGetUrl", async () => {
    const user = userEvent.setup()
    stubBucket({ objects: [{ key: "data.bin", size: 10, lastModified: "2026-07-01T10:00:00.000Z" }] })
    renderBrowse()

    await user.click(await screen.findByRole("button", { name: "共有" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "発行" }))

    const field = await within(dialog).findByRole("textbox", { name: "presigned URL" })
    const url = new URL((field as HTMLInputElement).value)
    expect(url.origin).toBe(ENDPOINT)
    expect(url.pathname).toBe(`/${BUCKET}/data.bin`)
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900")
    expect(url.searchParams.get("X-Amz-Security-Token")).toBeTruthy()
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy()
    expect(within(dialog).getByText(/頃まで有効/)).toBeInTheDocument()
    expect(within(dialog).getByText(/実効上限は約 1 時間/)).toBeInTheDocument()
  })

  test("BrowsePage_uploadUrlFlow_issuesPresignedPutUrl", async () => {
    const user = userEvent.setup()
    stubBucket({ prefix: "docs/" })
    renderBrowse("docs/")

    await user.click(await screen.findByRole("button", { name: "アップロード用 URL" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByRole("textbox", { name: "ファイル名" }), "incoming.bin")
    await user.click(within(dialog).getByRole("button", { name: "発行" }))

    const field = await within(dialog).findByRole("textbox", { name: "presigned URL" })
    const url = new URL((field as HTMLInputElement).value)
    expect(url.pathname).toBe(`/${BUCKET}/docs/incoming.bin`)
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy()
    expect(within(dialog).getByText(/curl -T/)).toBeInTheDocument()
  })

  test("BrowsePage_ttlEnabled_showsExpiryColumn", async () => {
    stubBucket({ objects: [{ key: "a.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" }] })
    renderBrowse("", { ...testConfig, fileTtlDays: 30 })

    expect(await screen.findByRole("columnheader", { name: "有効期限" })).toBeInTheDocument()
    // 2026-07-01T10:00Z + 30 日 (JST 表示)
    expect(screen.getByText(/2026\/07\/31/)).toBeInTheDocument()
  })

  test("BrowsePage_ttlDisabled_hidesExpiryColumn", async () => {
    stubBucket({ objects: [{ key: "a.txt", size: 1, lastModified: "2026-07-01T10:00:00.000Z" }] })
    renderBrowse()

    await screen.findByRole("cell", { name: "a.txt" })
    expect(screen.queryByRole("columnheader", { name: "有効期限" })).not.toBeInTheDocument()
  })

  test("BrowsePage_upload_putsObjectAndRefreshesList", async () => {
    const user = userEvent.setup()
    let uploaded = false
    server.use(
      http.head(`${ENDPOINT}/${BUCKET}`, () => new HttpResponse(null, { status: 200 })),
      http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listObjectsV2Xml({
          bucket: BUCKET,
          prefix: "",
          objects: uploaded ? [{ key: "new.txt", size: 1, lastModified: "2026-07-02T10:00:00.000Z" }] : [],
          commonPrefixes: [],
        }))),
      http.put(`${ENDPOINT}/${BUCKET}/new.txt`, () => {
        uploaded = true
        return new HttpResponse(null, { status: 200, headers: { ETag: "\"etag\"" } })
      }),
    )
    const { container } = renderBrowse()
    await screen.findByText("ファイルはまだありません。")

    const input = container.querySelector("input[type=file]")
    expect(input).not.toBeNull()
    await user.upload(input as HTMLInputElement, new File(["x"], "new.txt", { type: "text/plain" }))

    // Upload completes, the toast flips to success, and the invalidated list
    // shows the new object.
    expect(await screen.findByText("アップロード完了")).toBeInTheDocument()
    expect(await screen.findByRole("cell", { name: "new.txt" })).toBeInTheDocument()
  })

  test("BrowsePage_unsupportedUsername_showsGuidanceWithoutTouchingS3", async () => {
    seedAuthenticatedUser(testConfig, { username: "ts-kura_ddbj" })
    renderWithStub({
      routes: [{ path: "/", Component: () => <BrowsePage prefix="" /> }],
      initialEntries: ["/"],
    })
    expect(await screen.findByText("このユーザー名では kura を利用できません")).toBeInTheDocument()
    expect(screen.getByText(/ts-kura_ddbj/)).toBeInTheDocument()
  })
})
