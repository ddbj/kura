// AUTH Domain / P-ANON scope (scenarios.md §AUTH): LoginBox, redirect to
// Keycloak, callback error handling, and return-URL preservation.
import { expect, test } from "@playwright/test"

const oidcIssuer = (): string => {
  const v = process.env["KURA_E2E_OIDC_ISSUER"]
  if (!v) throw new Error("KURA_E2E_OIDC_ISSUER not set (globalSetup should populate it)")

  return v
}

test.describe("AUTH", () => {
  test("S-AUTH-01: 未認証で / を開くと LoginBox が表示される", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator(".loginbox")).toBeVisible()
    await expect(page.getByText("大容量ファイルの保管・共有")).toBeVisible()
    await expect(page.getByRole("button", { name: "DDBJ アカウントでログイン" })).toBeVisible()
    await expect(page.locator(".hdr")).toHaveCount(0)
  })

  test("S-AUTH-02: ログインボタンで Keycloak にリダイレクトされる", async ({ page }) => {
    await page.goto("/")

    const issuerUrl = new URL(oidcIssuer())
    await page.getByRole("button", { name: "DDBJ アカウントでログイン" }).click()
    await page.waitForURL((url) => new URL(url).hostname === issuerUrl.hostname)

    const url = new URL(page.url())
    expect(url.hostname).toBe(issuerUrl.hostname)
    expect(url.pathname).toBe(`${issuerUrl.pathname.replace(/\/+$/, "")}/protocol/openid-connect/auth`)
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge") ?? "").not.toBe("")
    expect(url.searchParams.get("client_id") ?? "").not.toBe("")
    expect((url.searchParams.get("scope") ?? "").split(" ")).toContain("openid")
    expect(url.searchParams.get("redirect_uri") ?? "").toMatch(/\/_auth\/callback$/)
    expect(url.searchParams.get("state") ?? "").not.toBe("")
  })

  test("E-AUTH-01: callback error=access_denied でエラーメッセージが出る", async ({ page }) => {
    await page.goto("/_auth/callback?error=access_denied&error_description=denied&state=x")
    const alert = page.getByRole("alert")
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("ログインに失敗しました")
    await expect(page.getByRole("link", { name: "トップへ戻る" })).toHaveAttribute("href", "/")
  })

  test("E-AUTH-02: callback error 画面の「トップへ戻る」で / に戻ると RequireAuth の error Callout が持続する", async ({ page }) => {
    await page.goto("/_auth/callback?error=access_denied&state=x")
    await page.getByRole("link", { name: "トップへ戻る" }).click()
    await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 15_000 })
    const alert = page.locator("[role=\"alert\"]").filter({ hasText: "ログインに失敗しました" })
    await expect(alert).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("button", { name: "再試行" })).toBeVisible()
  })

  test("E-AUTH-03: SPA route を未認証で叩くと LoginBox → 元 URL に戻る", async ({ page }) => {
    const username = process.env["E2E_USERNAME"]
    const password = process.env["E2E_PASSWORD"]
    if (!username || !password) throw new Error("E2E_USERNAME / E2E_PASSWORD required")

    // 元 URL: 存在しない prefix でも SPA fallback で LoginBox に飛ぶ
    const dirName = `e2e-authret-${Date.now().toString(36)}`
    await page.goto(`/_browse/${dirName}/`)
    await expect(page.locator(".loginbox")).toBeVisible()

    await page.getByRole("button", { name: "DDBJ アカウントでログイン" }).click()

    // Keycloak login form
    await page.locator("#username, input[name=username]").waitFor({ state: "visible", timeout: 60_000 })
    await page.locator("#username, input[name=username]").fill(username)
    await page.locator("#password, input[name=password]").fill(password)
    await page.locator("#kc-login, button[name=login]").click()

    // 元 URL に戻ってから SPA 起動を確認 (crumb 内容は BROWSE Domain で担保)
    await page.waitForURL(new RegExp(`/_browse/${dirName}/`), { timeout: 30_000 })
    await expect(page.locator(".hdr .user")).toBeVisible({ timeout: 30_000 })
  })
})
