import { screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { RequireAuth } from "~/shell/require-auth"

import { seedAuthenticatedUser } from "../_helpers/oidc"
import { renderWithStub, testConfig } from "../_helpers/render"

const renderGate = () =>
  renderWithStub({
    routes: [{
      path: "/",
      Component: () => (
        <RequireAuth>
          <p>secret-content</p>
        </RequireAuth>
      ),
    }],
    initialEntries: ["/"],
  })

describe("RequireAuth", () => {
  test("RequireAuth_initialRender_showsLoading", () => {
    renderGate()
    expect(screen.getByText("読み込み中…")).toBeInTheDocument()
    expect(screen.queryByText("secret-content")).not.toBeInTheDocument()
  })

  test("RequireAuth_unauthenticated_showsLoginPromptNotChildren", async () => {
    renderGate()
    expect(await screen.findByRole("button", { name: "ログイン" })).toBeInTheDocument()
    expect(screen.getByText(/DDBJ アカウントでログイン/)).toBeInTheDocument()
    expect(screen.queryByText("secret-content")).not.toBeInTheDocument()
  })

  test("RequireAuth_authenticatedViaStorage_rendersChildren", async () => {
    seedAuthenticatedUser(testConfig)
    renderGate()
    expect(await screen.findByText("secret-content")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "ログイン" })).not.toBeInTheDocument()
  })

  test("RequireAuth_expiredStoredSession_showsLoginPrompt", async () => {
    seedAuthenticatedUser(testConfig)
    const key = `oidc.user:${testConfig.oidcIssuer}:${testConfig.oidcClientId}`
    const stored = JSON.parse(window.sessionStorage.getItem(key) ?? "{}") as { expires_at: number }
    stored.expires_at = Math.floor(Date.now() / 1000) - 60
    window.sessionStorage.setItem(key, JSON.stringify(stored))
    renderGate()
    expect(await screen.findByRole("button", { name: "ログイン" })).toBeInTheDocument()
    expect(screen.queryByText("secret-content")).not.toBeInTheDocument()
  })
})
