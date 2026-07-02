import { screen, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { describe, expect, test, vi } from "vitest"

import { BrowsePage } from "~/routes/browse/browse-page"

import { seedAuthenticatedUser } from "../../_helpers/oidc"
import { renderWithStub, testConfig } from "../../_helpers/render"
import { listObjectsV2Xml, stsAssumeRoleXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const ENDPOINT = testConfig.s3Endpoint
const BUCKET = "kura-tester"

type ListedObject = { key: string; size: number; lastModified: string }

const stubBucket = ({ objects = [], commonPrefixes = [], prefix = "" }: {
  objects?: ListedObject[]
  commonPrefixes?: string[]
  prefix?: string
} = {}) => {
  const deleted: string[] = []
  server.use(
    http.head(`${ENDPOINT}/${BUCKET}`, () => new HttpResponse(null, { status: 200 })),
    http.get(`${ENDPOINT}/${BUCKET}`, () =>
      HttpResponse.xml(listObjectsV2Xml({ bucket: BUCKET, prefix, objects, commonPrefixes }))),
    http.delete(`${ENDPOINT}/${BUCKET}/:key+`, ({ params }) => {
      const key = params["key"]
      deleted.push(Array.isArray(key) ? key.join("/") : String(key))
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

const renderBrowse = (prefix = "") => {
  stubSts()
  seedAuthenticatedUser(testConfig, { username: BUCKET })
  return renderWithStub({
    routes: [
      { path: "/", Component: () => <BrowsePage prefix={prefix} /> },
      { path: "/_browse/*", Component: () => <p>navigated-to-splat</p> },
    ],
    initialEntries: ["/"],
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
