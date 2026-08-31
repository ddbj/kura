import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import type { ReactNode } from "react"
import { AuthProvider, useAuth } from "react-oidc-context"
import { beforeEach, describe, expect, test } from "vitest"

import { oidcProviderProps } from "~/lib/auth"
import { ConfigProvider } from "~/lib/config"
import { ShareModal } from "~/routes/browse/share-modal"

import { seedAuthenticatedUser } from "../../_helpers/oidc"
import { testConfig } from "../../_helpers/render"
import { stsAssumeRoleXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const ENDPOINT = testConfig.s3Endpoint

// Static metadata + disabled auto-renewal keep the AuthProvider off the
// network (discovery, silent-renew iframe), which jsdom cannot serve.
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

// Restoring the seeded session is async; issuing before it lands would fall
// through to a silent renew that jsdom cannot complete.
const AuthReady = () => {
  const auth = useAuth()

  return <span data-testid="auth-state">{auth.user ? "ready" : "pending"}</span>
}

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ConfigProvider value={testConfig}>
    <AuthProvider {...testAuthProps}>
      <AuthReady />
      {children}
    </AuthProvider>
  </ConfigProvider>
)

const TARGETS = [
  { bucket: "kura-tester", key: "e2e/a.txt", name: "a.txt", size: 10 },
  { bucket: "kura-tester", key: "e2e/b.txt", name: "b.txt", size: 20 },
]

const stsOk = () =>
  server.use(http.post(ENDPOINT, () =>
    HttpResponse.xml(stsAssumeRoleXml({
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
      sessionToken: "session-token",
      expiration: new Date(Date.now() + 3600_000).toISOString(),
    }))))

const stsFails = () =>
  server.use(http.post(ENDPOINT, () => new HttpResponse("boom", { status: 500 })))

const openModal = async () => {
  render(<Wrapper><ShareModal open onClose={() => undefined} targets={TARGETS} /></Wrapper>)
  await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("ready"))
  const modal = screen.getByRole("dialog", { name: "期限つきリンクを発行" })
  // The seeded access token has an hour left, so only the 15-minute lifetime
  // can be satisfied without renewing (which jsdom cannot do).
  await userEvent.click(within(modal).getByRole("tab", { name: "15分" }))

  return modal
}

// The file name also appears above each issued URL, so the status tag has to
// be looked up inside the target list.
const rowTag = (modal: HTMLElement, name: string): HTMLElement =>
  within(modal.querySelector(".flist") as HTMLElement)
    .getByText(name).closest(".frow") as HTMLElement

beforeEach(() => {
  window.sessionStorage.clear()
  seedAuthenticatedUser(testConfig, { username: "kura-tester" })
})

describe("ShareModal", () => {
  test("issues a URL per target and records it for the session", async () => {
    stsOk()
    const modal = await openModal()

    await userEvent.click(within(modal).getByRole("button", { name: "リンクを発行" }))

    await waitFor(() => {
      for (const target of TARGETS) {
        expect(within(rowTag(modal, target.name)).getByText("完了")).toBeInTheDocument()
      }
    })
    expect(within(modal).getAllByText(/X-Amz-Signature=/)).toHaveLength(TARGETS.length)
    expect(window.sessionStorage.getItem("kura.presigned")).toContain(TARGETS[0]!.key)
  })

  // Every target fails together here because each one mints its own STS
  // session and they are indistinguishable at the HTTP boundary; what matters
  // is that a failed batch stays retryable instead of dead-ending.
  test("marks a failed batch as retryable and recovers on retry", async () => {
    stsFails()
    const modal = await openModal()

    await userEvent.click(within(modal).getByRole("button", { name: "リンクを発行" }))

    await waitFor(() => {
      for (const target of TARGETS) {
        expect(within(rowTag(modal, target.name)).getByText("失敗")).toBeInTheDocument()
      }
    })
    const retry = within(modal).getByRole("button", { name: `失敗した${TARGETS.length}件を再試行` })

    stsOk()
    await userEvent.click(retry)

    await waitFor(() => {
      for (const target of TARGETS) {
        expect(within(rowTag(modal, target.name)).getByText("完了")).toBeInTheDocument()
      }
    })
    expect(within(modal).queryByText("失敗")).not.toBeInTheDocument()
  })

  // A presigned URL cannot be extended or revoked once issued, so the modal
  // must not offer a lifetime control that would re-label the URLs on screen.
  test("removes the lifetime control and the issue button once anything is issued", async () => {
    stsOk()
    const modal = await openModal()

    await userEvent.click(within(modal).getByRole("button", { name: "リンクを発行" }))
    await waitFor(() => expect(within(modal).getAllByText(/X-Amz-Signature=/)).toHaveLength(TARGETS.length))

    expect(within(modal).queryByRole("tablist", { name: "有効期限" })).not.toBeInTheDocument()
    expect(within(modal).queryByRole("button", { name: "リンクを発行" })).not.toBeInTheDocument()
    expect(within(modal).getByRole("button", { name: "閉じる" })).toBeInTheDocument()
  })
})
