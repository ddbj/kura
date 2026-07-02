import { screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { describe, expect, test } from "vitest"

import { LANG_STORAGE_KEY } from "~/lib/i18n"
import { Header } from "~/shell/header"

import { seedAuthenticatedUser } from "../_helpers/oidc"
import { renderWithStub, testConfig } from "../_helpers/render"

const renderHeader = () =>
  renderWithStub({
    routes: [{ path: "/", Component: () => <Header /> }],
    initialEntries: ["/"],
  })

describe("Header", () => {
  test("Header_authenticated_showsUsernameAndLogout", async () => {
    seedAuthenticatedUser(testConfig, { username: "kura-tester" })
    renderHeader()
    expect(await screen.findByText("kura-tester")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument()
  })

  test("Header_unauthenticated_hasNoUserMenu", () => {
    renderHeader()
    expect(screen.queryByText("kura-tester")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "ログアウト" })).not.toBeInTheDocument()
  })

  test("Header_switchLang_persistsToLocalStorageAndSwitchesLabels", async () => {
    const user = userEvent.setup()
    renderHeader()
    await user.click(screen.getByRole("button", { name: "言語切替" }))
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe("en")
    // 表示言語が実際に切り替わる (tagline は翻訳済み文言)。
    expect(await screen.findByText("File server")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Switch language" }))
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe("ja")
    expect(await screen.findByText("ファイルサーバー")).toBeInTheDocument()
  })
})
