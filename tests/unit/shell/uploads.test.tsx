import { screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { delay, http, HttpResponse } from "msw"
import { describe, expect, test, vi } from "vitest"

import { useUploads } from "~/shell"
import { Button } from "~/ui"

import { seedAuthenticatedUser } from "../_helpers/oidc"
import { renderWithStub, testConfig } from "../_helpers/render"
import { stsAssumeRoleXml } from "../mocks/s3-xml"
import { server } from "../mocks/server"

const ENDPOINT = testConfig.s3Endpoint
const BUCKET = "kura-tester"

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

const UploadTrigger = ({ files }: { files: File[] }) => {
  const { startUploads } = useUploads()

  return <Button onClick={() => startUploads(BUCKET, "docs/", files)}>go</Button>
}

const renderUploads = (files: File[]) => {
  stubSts()
  seedAuthenticatedUser(testConfig, { username: BUCKET })

  return renderWithStub({
    routes: [{ path: "/", Component: () => <UploadTrigger files={files} /> }],
    initialEntries: ["/"],
  })
}

describe("UploadsProvider", () => {
  test("startUploads_success_transitionsToastToSuccess", async () => {
    const user = userEvent.setup()
    const putKeys: string[] = []
    server.use(http.put(`${ENDPOINT}/${BUCKET}/docs/hello.txt`, async ({ request }) => {
      putKeys.push(await request.text())
      return new HttpResponse(null, { status: 200, headers: { ETag: "\"etag\"" } })
    }))
    renderUploads([new File(["hello"], "hello.txt", { type: "text/plain" })])

    await user.click(screen.getByRole("button", { name: "go" }))
    expect(await screen.findByText("アップロード完了")).toBeInTheDocument()
    expect(screen.getByText("hello.txt")).toBeInTheDocument()
    expect(putKeys).toEqual(["hello"])
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  test("startUploads_failure_showsErrorToastWithAlertRole", async () => {
    const user = userEvent.setup()
    server.use(http.put(`${ENDPOINT}/${BUCKET}/docs/broken.txt`, () =>
      new HttpResponse(null, { status: 500 })))
    renderUploads([new File(["x"], "broken.txt", { type: "text/plain" })])

    await user.click(screen.getByRole("button", { name: "go" }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("broken.txt")
    expect(alert).toHaveTextContent(/アップロードに失敗しました/)
  })

  test("startUploads_cancel_dismissesToast", async () => {
    const user = userEvent.setup()
    server.use(http.put(`${ENDPOINT}/${BUCKET}/docs/slow.txt`, async () => {
      await delay(5_000)
      return new HttpResponse(null, { status: 200, headers: { ETag: "\"etag\"" } })
    }))
    renderUploads([new File(["x"], "slow.txt", { type: "text/plain" })])

    await user.click(screen.getByRole("button", { name: "go" }))
    expect(await screen.findByText("slow.txt")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "キャンセル" }))
    await vi.waitFor(() => expect(screen.queryByText("slow.txt")).not.toBeInTheDocument())
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  test("startUploads_multipleFiles_showsToastPerFile", async () => {
    const user = userEvent.setup()
    server.use(http.put(`${ENDPOINT}/${BUCKET}/docs/:name`, () =>
      new HttpResponse(null, { status: 200, headers: { ETag: "\"etag\"" } })))
    renderUploads([
      new File(["1"], "one.txt", { type: "text/plain" }),
      new File(["2"], "two.txt", { type: "text/plain" }),
    ])

    await user.click(screen.getByRole("button", { name: "go" }))
    expect(await screen.findByText("one.txt")).toBeInTheDocument()
    expect(await screen.findByText("two.txt")).toBeInTheDocument()
    expect(await screen.findAllByText("アップロード完了")).toHaveLength(2)
  })
})
