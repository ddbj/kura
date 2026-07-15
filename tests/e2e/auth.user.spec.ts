// AUTH Domain / P-USER scope (scenarios.md §AUTH): storageState 復元後の
// SPA 起動時の HeadBucket 発火 pin、bucket 初期化失敗 UI、logout 経路。
import { expect } from "@playwright/test"

import { e2eUsername, s3Endpoint } from "./_helpers"
import { test } from "./fixtures"

test.describe("AUTH.user", () => {
  test("S-AUTH-03: storageState 復元で / を開くと Header が出る", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator(".hdr")).toBeVisible()
    await expect(page.locator(".hdr .user")).toContainText(e2eUsername())
    expect(new URL(page.url()).pathname).toBe("/")
  })

  test("S-AUTH-04: 初回訪問で HeadBucket が発行される", async ({ page }) => {
    const bucket = e2eUsername()
    const headPromise = page.waitForRequest((req) => {
      if (req.method() !== "HEAD") return false
      try {
        const p = new URL(req.url()).pathname.replace(/\/+$/, "")

        return p === `/${bucket}`
      } catch {
        return false
      }
    }, { timeout: 15_000 })
    await page.goto("/")
    await headPromise

    await expect(page.locator(".hdr .user")).toBeVisible()
    await expect(page.locator(".pathbar .crumb .cur")).toHaveText(bucket)
    await expect(page.locator(".upcard")).toHaveCount(0)
  })

  test("S-AUTH-05: fresh login → logout → LoginBox 復帰", async ({ browser }) => {
    const username = process.env["E2E_LOGOUT_USERNAME"]
    const password = process.env["E2E_LOGOUT_PASSWORD"]
    test.skip(!username || !password, "logout requires E2E_LOGOUT_USERNAME / E2E_LOGOUT_PASSWORD (第 2 テストユーザー)")

    // storageState を明示的に空にする (browser.newContext without
    // storageState は fresh とはいえ、`chromium-user` project の default
    // storageState (auth.setup が焼いた Keycloak SSO cookie 込み) が
    // どこかで漏れてくるとテストが auto-login されて login form が
    // 出ずに fail する)。明示 empty で強制的に匿名 context にする。
    const ctx = await browser.newContext({
      locale: "ja-JP",
      storageState: { cookies: [], origins: [] },
    })
    const page = await ctx.newPage()
    try {
      await page.goto("/")
      await expect(page.locator(".loginbox")).toBeVisible()

      await page.getByRole("button", { name: "DDBJ アカウントでログイン" }).click()
      await page.locator("#username, input[name=username]").waitFor({ state: "visible", timeout: 60_000 })
      await page.locator("#username, input[name=username]").fill(username as string)
      await page.locator("#password, input[name=password]").fill(password as string)
      await page.locator("#kc-login, button[name=login]").click()

      await expect(page.locator(".hdr .user")).toBeVisible({ timeout: 30_000 })

      await page.locator(".hdr .user").click()
      await page.locator(".usermenu").getByRole("menuitem", { name: /ログアウト|Log out/ }).click()

      await expect(page.getByRole("button", { name: "DDBJ アカウントでログイン" })).toBeVisible({ timeout: 30_000 })
    } finally {
      await ctx.close()
    }
  })

  test("E-AUTH-04: bucket 初期化失敗のときエラー Callout が出る", async ({ page }) => {
    const bucket = e2eUsername()
    const originHost = new URL(s3Endpoint()).host

    // HEAD /${bucket}/ → 404 (bucket 未作成偽装) / PUT /${bucket}/ → 500 (create fails)。
    // /${bucket}/<key> 等の後続 op は path 末尾に key が続くため match しない。
    await page.route((url) => {
      if (url.host !== originHost) return false
      const p = url.pathname.replace(/\/+$/, "")

      return p === `/${bucket}`
    }, (route) => {
      const method = route.request().method()
      if (method === "HEAD") {
        return route.fulfill({
          status: 404,
          contentType: "application/xml",
          body: "<Error><Code>NoSuchBucket</Code></Error>",
        })
      }
      if (method === "PUT") {
        return route.fulfill({
          status: 500,
          contentType: "application/xml",
          body: "<Error><Code>InternalError</Code></Error>",
        })
      }

      return route.continue()
    })

    await page.goto("/")

    const alert = page.locator("[role=\"alert\"]").filter({ hasText: "領域の初期化に失敗しました" })
    await expect(alert).toBeVisible({ timeout: 15_000 })
    await expect(alert.getByRole("button", { name: "再試行" })).toBeVisible()
  })
})
