// PRESIGN Domain (scenarios.md §PRESIGN): row → ShareModal → 期限つき tab →
// TTL 選択 → 発行 → badge + panel + fresh anon で byte 一致。
import { expect } from "@playwright/test"

import {
  clearClientPrefs,
  expandRow,
  getAnon,
  getPresignPanel,
  getRow,
  openPresignModalFromRow,
  s3Endpoint,
  scopeBrowseUrl,
  uniqueName,
  uploadTextFile,
} from "./_helpers"
import { test } from "./fixtures"

test.describe("PRESIGN", () => {
  test.afterEach(async ({ page }) => {
    await clearClientPrefs(page).catch(() => undefined)
  })

  test("S-PRESIGN-01: row → ShareModal → 期限つき tab → 発行 → badge + panel + byte 一致", async ({ browser, page }) => {
    const name = uniqueName("presign01")
    const content = "presign01-body-fixed-payload"
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, content)

    const modal = await openPresignModalFromRow(page, name)
    // 期限つき tab の aria-selected
    await expect(modal.getByRole("tablist", { name: "共有モード" }).getByRole("tab", { name: "期限つき", selected: true }))
      .toBeVisible()
    // default TTL は 12時間
    await expect(modal.getByRole("tablist", { name: "有効期限" }).getByRole("tab", { name: "12時間", selected: true }))
      .toBeVisible()

    await modal.getByRole("button", { name: "リンクを発行" }).click()
    await expect(modal.locator(".flist .frow").filter({ hasText: name }).locator(".tag.ok"))
      .toHaveText("完了", { timeout: 15_000 })

    // modal 内 LinkBar から URL 取得
    const modalLinkBar = modal.locator(".linkbar")
    const modalUrl = await modalLinkBar.locator(".u").textContent()
    expect(modalUrl).not.toBeNull()
    expect(modalUrl!).toContain("X-Amz-Signature=")
    const s3Host = new URL(s3Endpoint()).host
    expect(new URL(modalUrl!).host).toBe(s3Host)
    // まで有効 substring — `filter({ hasText })` は子孫でも match するため
    // 祖先 div が複数 match してしまう。`getByText` の正規表現マッチは
    // element の text 全体で一致するので leaf に絞れる。
    await expect(modal.getByText(/^.+ まで有効$/)).toBeVisible()

    // 閉じる
    await modal.getByRole("button", { name: "閉じる" }).click()

    const row = getRow(page, name)
    await expect(row.locator(".c-pub .tag.warn")).toHaveText("期限つき", { timeout: 15_000 })

    await expandRow(page, name)
    const panel = getPresignPanel(page, name)
    const rowUrl = await panel.locator(".linkbar .u").textContent()
    expect(rowUrl).toBe(modalUrl)
    // pp-top の lbl に "期限つきリンク — 約" と "分後に自動で失効します" 両 substring
    const lbl = await panel.locator(".pp-top .lbl").textContent()
    expect(lbl).toContain("期限つきリンク — 約")
    expect(lbl).toContain("分後に自動で失効します")

    // sessionStorage の kura.presigned が bucket-scoped entry を含み URL 一致
    const stored = await page.evaluate(() => sessionStorage.getItem("kura.presigned"))
    expect(stored).not.toBeNull()
    expect(stored!).toContain(modalUrl!)

    // fresh anon context (cookie / storage 非依存) で URL を叩き byte 一致
    const { context, response } = await getAnon(browser, modalUrl!)
    try {
      expect(response.status()).toBe(200)
      const body = await response.body()
      expect(body.toString()).toBe(content)
    } finally {
      await context.close()
    }
  })

  test("S-PRESIGN-02: TTL の 3 tab 切替と banner text の対応", async ({ page }) => {
    const name = uniqueName("presign02")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "presign02")

    const modal = await openPresignModalFromRow(page, name)
    const ttlList = modal.getByRole("tablist", { name: "有効期限" })

    for (const { tab, banner } of [
      { tab: "15分", banner: "約15分後" },
      { tab: "1時間", banner: "約1時間後" },
      { tab: "12時間", banner: "約12時間後" },
    ]) {
      await ttlList.getByRole("tab", { name: tab }).click()
      await expect(ttlList.getByRole("tab", { name: tab, selected: true })).toBeVisible()
      await expect(modal.locator(".banner.ochre")).toContainText(banner)
    }
  })
})
