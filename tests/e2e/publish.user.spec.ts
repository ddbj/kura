// PUBLISH Domain (scenarios.md §PUBLISH): row / bulk 公開 → 公開バッジ + pubpanel、
// 停止で 404、bulk 混在失敗 → 再試行、mode 切替の rowStates リセット。
import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

import {
  clearClientPrefs,
  e2eUsername,
  expandRow,
  getBulkBar,
  getPubPanel,
  getRow,
  scopeBrowseUrl,
  scopePrefix,
  uniqueName,
  uploadTextFile,
} from "./_helpers"
import { test } from "./fixtures"

const openShareModalFromRow = async (page: Page, filename: string): Promise<void> => {
  const row = getRow(page, filename)
  await row.locator(".pubbtn").click()
  await page.getByRole("dialog", { name: "ファイルを公開" }).waitFor({ state: "visible" })
}

test.describe("PUBLISH", () => {
  test.afterEach(async ({ page }) => {
    await clearClientPrefs(page).catch(() => undefined)
  })

  test("S-PUBLISH-01: 単一 file を row-inline で公開 → pubpanel 展開 → 公開バッジ", async ({ page }) => {
    const name = uniqueName("pub01")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "pub-content")

    await openShareModalFromRow(page, name)
    const modal = page.getByRole("dialog", { name: "ファイルを公開" })
    await modal.getByRole("button", { name: "公開する" }).click()
    await expect(modal.locator(".flist .frow").filter({ hasText: name }).locator(".tag.ok"))
      .toHaveText("完了", { timeout: 15_000 })
    await modal.getByRole("button", { name: "閉じる" }).click()

    const row = getRow(page, name)
    await expect(row.locator(".c-pub .tag.ok")).toHaveText("公開中", { timeout: 15_000 })
    await expect(row.locator(".pubbtn")).toHaveText("公開を停止")

    await expandRow(page, name)
    const publicUrl = await getPubPanel(page, name).locator(".linkbar .u").textContent()
    expect(publicUrl).toMatch(/^http:\/\/localhost:28080\//)
  })

  test("S-PUBLISH-02: pubpanel の URL が SPA context 内で GET 200", async ({ page }) => {
    const name = uniqueName("pub02")
    const content = "pub02-body"
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, content)

    await openShareModalFromRow(page, name)
    const modal = page.getByRole("dialog", { name: "ファイルを公開" })
    await modal.getByRole("button", { name: "公開する" }).click()
    await expect(modal.locator(".flist .frow").locator(".tag.ok")).toHaveText("完了", { timeout: 15_000 })
    await modal.getByRole("button", { name: "閉じる" }).click()

    await expandRow(page, name)
    const url = await getPubPanel(page, name).locator(".linkbar .u").textContent()
    expect(url).not.toBeNull()

    const res = await page.request.get(url as string)
    expect(res.status()).toBe(200)
    const body = await res.body()
    expect(body.toString()).toBe(content)
  })

  test("S-PUBLISH-03: pubpanel の コピー button でクリップボードに URL", async ({ page }) => {
    const name = uniqueName("pub03")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "pub03")

    await openShareModalFromRow(page, name)
    const modal = page.getByRole("dialog", { name: "ファイルを公開" })
    await modal.getByRole("button", { name: "公開する" }).click()
    await expect(modal.locator(".flist .frow").locator(".tag.ok")).toHaveText("完了", { timeout: 15_000 })
    await modal.getByRole("button", { name: "閉じる" }).click()

    await expandRow(page, name)
    const panel = getPubPanel(page, name)
    const url = await panel.locator(".linkbar .u").textContent()

    const copyBtn = panel.locator(".linkbar .cp")
    await expect(copyBtn).toHaveText("コピー")
    await copyBtn.click()
    await expect(copyBtn).toHaveText("コピー済み", { timeout: 1_600 })

    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe(url)
  })

  test("S-PUBLISH-04: 公開停止で 公開中 バッジ消失、URL が SPA context 内で 404", async ({ page }) => {
    const name = uniqueName("pub04")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "pub04")

    await openShareModalFromRow(page, name)
    const modal = page.getByRole("dialog", { name: "ファイルを公開" })
    await modal.getByRole("button", { name: "公開する" }).click()
    await expect(modal.locator(".flist .frow").locator(".tag.ok")).toHaveText("完了", { timeout: 15_000 })
    await modal.getByRole("button", { name: "閉じる" }).click()

    const row = getRow(page, name)
    await expandRow(page, name)
    const url = await getPubPanel(page, name).locator(".linkbar .u").textContent()
    expect(url).not.toBeNull()

    // 停止 — confirmation なし、即実行
    await row.locator(".pubbtn").click()
    await expect(row.locator(".c-pub .tag.ok")).toHaveCount(0, { timeout: 15_000 })
    await expect(row.locator(".pubbtn")).toHaveText("公開する", { timeout: 5_000 })

    const res = await page.request.get(url as string)
    expect(res.status()).toBe(404)
  })

  test("S-PUBLISH-05: bulk 公開 (2 件 checkbox 選択 → 公開)", async ({ page }) => {
    const name1 = uniqueName("bulk1")
    const name2 = uniqueName("bulk2")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name1, "b1")
    await uploadTextFile(page, name2, "b2")

    await page.getByRole("checkbox", { name: `${name1} を選択` }).check()
    await page.getByRole("checkbox", { name: `${name2} を選択` }).check()

    await getBulkBar(page).getByRole("button", { name: "公開する" }).click()
    const modal = page.getByRole("dialog", { name: "ファイルを公開" })
    await modal.waitFor({ state: "visible" })
    await modal.getByRole("button", { name: "公開する" }).click()
    await expect(modal.locator(".flist .frow").locator(".tag.ok")).toHaveCount(2, { timeout: 30_000 })
    await modal.getByRole("button", { name: "閉じる" }).click()

    for (const name of [name1, name2]) {
      await expect(getRow(page, name).locator(".c-pub .tag.ok")).toHaveText("公開中", { timeout: 10_000 })
    }
  })

  test("S-PUBLISH-06a: ShareModal で mode 切替 (未発行 → mode swap)", async ({ page }) => {
    const name = uniqueName("pub06a")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "swap-a")

    await openShareModalFromRow(page, name)
    const pubModal = page.getByRole("dialog", { name: "ファイルを公開" })
    await pubModal.getByRole("tablist", { name: "共有モード" }).getByRole("tab", { name: "期限つき" }).click()

    const tempModal = page.getByRole("dialog", { name: "期限つきリンクを発行" })
    await expect(tempModal).toBeVisible()
    const ttlTablist = tempModal.getByRole("tablist", { name: "有効期限" })
    await expect(ttlTablist).toBeVisible()
    // default `12時間`
    await expect(ttlTablist.getByRole("tab", { name: "12時間", selected: true })).toBeVisible()
    // .flist rowStates が未発行 (発行中 / 完了 / 失敗 tag が出ていない)
    await expect(tempModal.locator(".flist .frow .tag.ok")).toHaveCount(0)
    await expect(tempModal.locator(".flist .frow .tag.fail")).toHaveCount(0)
  })

  test("S-PUBLISH-06b: ShareModal で mode 切替 (発行済み → mode swap で state リセット)", async ({ page }) => {
    const name1 = uniqueName("pub06b1")
    const name2 = uniqueName("pub06b2")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name1, "b1")
    await uploadTextFile(page, name2, "b2")

    const bucket = e2eUsername()
    const name2Key = `${scopePrefix()}${name2}`
    // 同一の function reference を保持して unroute 時に一致させる。
    const taggingMatcher = (url: URL): boolean =>
      url.pathname === `/${bucket}/${name2Key}` && url.search.includes("tagging")
    await page.route(taggingMatcher, (route) => {
      if (route.request().method() === "PUT") {
        return route.fulfill({
          status: 500,
          contentType: "application/xml",
          body: "<Error><Code>InternalError</Code></Error>",
        })
      }

      return route.continue()
    })

    await page.getByRole("checkbox", { name: `${name1} を選択` }).check()
    await page.getByRole("checkbox", { name: `${name2} を選択` }).check()
    await getBulkBar(page).getByRole("button", { name: "公開する" }).click()

    const modal = page.getByRole("dialog", { name: "ファイルを公開" })
    await modal.getByRole("button", { name: "公開する" }).click()
    // 1 件成功 + 1 件失敗 になるまで待つ (AWS SDK v3 は 500 を retry するので少し時間かかる)
    await expect(modal.locator(".flist .frow").locator(".tag.ok")).toHaveCount(1, { timeout: 60_000 })
    await expect(modal.locator(".flist .frow").locator(".tag.fail")).toHaveCount(1, { timeout: 60_000 })

    // intercept 解除 (mode 切替後の retry には影響させない)
    await page.unroute(taggingMatcher)

    // mode 切替 → rowStates 完全リセット
    await modal.getByRole("tablist", { name: "共有モード" }).getByRole("tab", { name: "期限つき" }).click()
    const tempModal = page.getByRole("dialog", { name: "期限つきリンクを発行" })
    await expect(tempModal).toBeVisible()
    await expect(tempModal.locator(".flist .frow .tag.ok")).toHaveCount(0)
    await expect(tempModal.locator(".flist .frow .tag.fail")).toHaveCount(0)
  })

  test("E-PUBLISH-01: 混在失敗 → 失敗した N 件を再試行 (multi target)", async ({ page }) => {
    const name1 = uniqueName("epub1")
    const name2 = uniqueName("epub2")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name1, "1")
    await uploadTextFile(page, name2, "2")

    const bucket = e2eUsername()
    const name2Key = `${scopePrefix()}${name2}`
    const taggingMatcher = (url: URL): boolean =>
      url.pathname === `/${bucket}/${name2Key}` && url.search.includes("tagging")
    await page.route(taggingMatcher, (route) => {
      if (route.request().method() === "PUT") {
        return route.fulfill({
          status: 500,
          contentType: "application/xml",
          body: "<Error><Code>InternalError</Code></Error>",
        })
      }

      return route.continue()
    })

    await page.getByRole("checkbox", { name: `${name1} を選択` }).check()
    await page.getByRole("checkbox", { name: `${name2} を選択` }).check()
    await getBulkBar(page).getByRole("button", { name: "公開する" }).click()

    const modal = page.getByRole("dialog", { name: "ファイルを公開" })
    await modal.getByRole("button", { name: "公開する" }).click()
    await expect(modal.locator(".flist .frow").locator(".tag.ok")).toHaveCount(1, { timeout: 60_000 })
    await expect(modal.locator(".flist .frow").locator(".tag.fail")).toHaveCount(1, { timeout: 60_000 })

    // footer button text が "失敗した1件を再試行"
    const retryBtn = modal.getByRole("button", { name: /失敗した\d+件を再試行/ })
    await expect(retryBtn).toBeVisible()

    // intercept 解除 — 同一 fn reference を渡す (Playwright の unroute は
    // 参照一致で route を消す)
    await page.unroute(taggingMatcher)

    await retryBtn.click()
    await expect(modal.locator(".flist .frow").locator(".tag.ok")).toHaveCount(2, { timeout: 30_000 })
    await expect(modal.locator(".flist .frow").locator(".tag.fail")).toHaveCount(0)

    await modal.getByRole("button", { name: "閉じる" }).click()

    for (const name of [name1, name2]) {
      await expect(getRow(page, name).locator(".c-pub .tag.ok")).toHaveText("公開中", { timeout: 15_000 })
    }
  })
})
