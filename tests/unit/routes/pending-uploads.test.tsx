import { screen, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { describe, expect, test, vi } from "vitest"

import { PendingUploads } from "~/routes/browse/pending-uploads"
import { RequireAuth } from "~/shell"

import { seedAuthenticatedUser } from "../_helpers/oidc"
import { renderWithStub, testConfig } from "../_helpers/render"
import {
  completeMultipartUploadXml,
  listMultipartUploadsXml,
  listPartsXml,
  stsAssumeRoleXml,
} from "../mocks/s3-xml"
import { server } from "../mocks/server"

const ENDPOINT = testConfig.s3Endpoint
const BUCKET = "kura-tester"
const MiB = 1024 * 1024
// MD5 hex of 8 MiB of 0x07 (pre-computed; node:crypto is unavailable here).
const MD5_PART1 = "0060f6593824eacb6d4b9785b315167c"

const stubSts = () =>
  server.use(
    http.post(`${ENDPOINT}/`, () =>
      HttpResponse.xml(stsAssumeRoleXml({
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret",
        sessionToken: "session-token",
        expiration: new Date(Date.now() + 3600_000).toISOString(),
      }))),
    // oidc-client-ts fetches the issuer metadata when a silent renew fires
    // (timers can leak past cleanup between tests).
    http.get(`${testConfig.oidcIssuer}/.well-known/openid-configuration`, () =>
      HttpResponse.json({ issuer: testConfig.oidcIssuer })),
  )

// One interrupted upload of docs/big.bin with its first 8 MiB part done.
const stubOnePendingUpload = () => {
  server.use(
    http.get(`${ENDPOINT}/${BUCKET}`, ({ request }) => {
      const url = new URL(request.url)
      if (!url.searchParams.has("uploads") || url.searchParams.get("prefix") !== "docs/") {
        return new HttpResponse(null, { status: 400 })
      }

      return HttpResponse.xml(listMultipartUploadsXml({
        bucket: BUCKET,
        uploads: [{ key: "docs/big.bin", uploadId: "up-1" }],
      }))
    }),
    http.get(`${ENDPOINT}/${BUCKET}/docs/big.bin`, () =>
      HttpResponse.xml(listPartsXml({
        bucket: BUCKET,
        key: "docs/big.bin",
        uploadId: "up-1",
        parts: [{
          partNumber: 1,
          size: 8 * MiB,
          etag: MD5_PART1,
          lastModified: "2026-07-01T12:00:00Z",
        }],
      }))),
  )
}

const renderPending = () => {
  stubSts()
  seedAuthenticatedUser(testConfig, { username: BUCKET })

  // RequireAuth mirrors the real page structure: queries must not fire before
  // the auth session is restored (they would trigger a silent renew).
  return renderWithStub({
    routes: [{
      path: "/",
      Component: () => (
        <RequireAuth>
          <PendingUploads bucket={BUCKET} prefix="docs/" />
        </RequireAuth>
      ),
    }],
    initialEntries: ["/"],
  })
}

describe("PendingUploads", () => {
  test("pendingUploads_interruptedUpload_showsRelativeKeyAndProgress", async () => {
    stubOnePendingUpload()
    renderPending()

    const section = await screen.findByRole("region", { name: "再開待ちのアップロード" })
    expect(within(section).getByText("big.bin")).toBeInTheDocument()
    expect(within(section).getByText(/8\.0 MiB アップロード済み/)).toBeInTheDocument()
  })

  test("pendingUploads_noneInterrupted_rendersNothing", async () => {
    server.use(http.get(`${ENDPOINT}/${BUCKET}`, () =>
      HttpResponse.xml(listMultipartUploadsXml({ bucket: BUCKET, uploads: [] }))))
    renderPending()

    await vi.waitFor(() =>
      expect(screen.queryByText("再開待ちのアップロード")).not.toBeInTheDocument())
  })

  test("pendingUploads_discardConfirmed_deletesAndDisappears", async () => {
    const user = userEvent.setup()
    stubOnePendingUpload()
    const discarded: string[] = []
    server.use(http.delete(`${ENDPOINT}/${BUCKET}/docs/big.bin`, ({ request }) => {
      discarded.push(new URL(request.url).searchParams.get("uploadId") ?? "?")
      // After the discard the server no longer lists the upload.
      server.use(http.get(`${ENDPOINT}/${BUCKET}`, () =>
        HttpResponse.xml(listMultipartUploadsXml({ bucket: BUCKET, uploads: [] }))))

      return new HttpResponse(null, { status: 204 })
    }))
    renderPending()

    await screen.findByRole("region", { name: "再開待ちのアップロード" }, { timeout: 5_000 })
    await user.click(await screen.findByRole("button", { name: "破棄" }))
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("big.bin")
    await user.click(within(dialog).getByRole("button", { name: "破棄" }))

    await vi.waitFor(() => {
      expect(discarded).toEqual(["up-1"])
      expect(screen.queryByText("再開待ちのアップロード")).not.toBeInTheDocument()
    })
  })

  test("pendingUploads_discardFails_showsAlertAndKeepsTheEntry", async () => {
    const user = userEvent.setup()
    stubOnePendingUpload()
    server.use(http.delete(`${ENDPOINT}/${BUCKET}/docs/big.bin`, () =>
      new HttpResponse(null, { status: 500 })))
    renderPending()

    await screen.findByRole("region", { name: "再開待ちのアップロード" }, { timeout: 5_000 })
    await user.click(await screen.findByRole("button", { name: "破棄" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "破棄" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("破棄に失敗しました")
    expect(screen.getByRole("region", { name: "再開待ちのアップロード" })).toBeInTheDocument()
  })

  test("pendingUploads_filePicked_resumesVerifiesAndCompletes", async () => {
    const user = userEvent.setup()
    stubOnePendingUpload()
    const uploadedParts: string[] = []
    server.use(
      http.put(`${ENDPOINT}/${BUCKET}/docs/big.bin`, ({ request }) => {
        uploadedParts.push(new URL(request.url).searchParams.get("partNumber") ?? "?")

        return new HttpResponse(null, { status: 200, headers: { ETag: "\"e2\"" } })
      }),
      http.post(`${ENDPOINT}/${BUCKET}/docs/big.bin`, () =>
        HttpResponse.xml(completeMultipartUploadXml({
          bucket: BUCKET, key: "docs/big.bin", etag: "final",
        }))),
    )
    const { container } = renderPending()

    await screen.findByRole("button", { name: "ファイルを選んで再開" })
    const input = container.querySelector<HTMLInputElement>("input[type=file]")
    expect(input).not.toBeNull()
    // Same bytes the interrupted upload came from: part 1 is 8 MiB of 0x07.
    await user.upload(input!, new File([new Uint8Array(16 * MiB).fill(7)], "big.bin"))

    expect(await screen.findByText("アップロード完了", {}, { timeout: 20_000 })).toBeInTheDocument()
    expect(uploadedParts).toEqual(["2"])
  }, 60_000)
})
