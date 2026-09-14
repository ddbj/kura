// PRESIGN Domain (scenarios.md §PRESIGN): row → ShareModal → TTL 選択 →
// 発行 → badge + panel + fresh anon で byte 一致。
import { expect } from "@playwright/test"

import {
  clearClientPrefs,
  expandRow,
  getAnon,
  getPresignPanel,
  getRow,
  openPresignModalFromRow,
  openRowMenu,
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

  test("S-PRESIGN-01: row → ShareModal → 発行 → badge + panel + byte 一致", async ({ browser, page }) => {
    const name = uniqueName("presign01")
    const content = "presign01-body-fixed-payload"
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, content)

    const modal = await openPresignModalFromRow(page, name)
    // default TTL は 最長 (= 認証セッションの残り)
    await expect(modal.getByRole("tablist", { name: "有効期限" }).getByRole("tab", { name: "最長", selected: true }))
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
    // 残り時間は「N 時間 M 分」/「N 時間」/「M 分」のいずれかで出る (session の
    // 残り寿命と 30 秒 tick 次第なので、数値そのものは pin しない)
    const lbl = await panel.locator(".pp-top .lbl").textContent()
    expect(lbl).toMatch(/^期限つきリンク — 約(\d+ 時間)?\s?(\d+ 分)?後に自動で失効します$/)
    expect(lbl).toMatch(/\d/)

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
      { tab: "15分", banner: "リンクは約15 分後に切れます" },
      { tab: "1時間", banner: "リンクは約1 時間後に切れます" },
    ]) {
      await ttlList.getByRole("tab", { name: tab }).click()
      await expect(ttlList.getByRole("tab", { name: tab, selected: true })).toBeVisible()
      await expect(modal.locator(".banner.ochre")).toContainText(banner)
    }

    // 「最長」は認証セッションの残りに切り詰められるので、値ではなく
    // 「セッション残りである」と説明していることを見る
    await ttlList.getByRole("tab", { name: "最長" }).click()
    await expect(ttlList.getByRole("tab", { name: "最長", selected: true })).toBeVisible()
    const banner = modal.locator(".banner.ochre")
    await expect(banner).toContainText("「最長」はいまの認証セッションの残り時間です")
    await expect(banner).toContainText(/リンクは約(\d+ 時間)?\s?(\d+ 分)?後に切れます/)
  })

  // rename / move は copy + delete なので、発行済みの URL は元 key ごと 404 に
  // なる。記録を残すと lens の件数だけが実体なく残ってしまう。
  test("S-PRESIGN-03: rename すると presign の記録が落ちて lens も戻る", async ({ page }) => {
    const name = uniqueName("presign03")
    const renamed = uniqueName("presign03-renamed")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "presign03")

    const modal = await openPresignModalFromRow(page, name)
    await modal.getByRole("button", { name: "リンクを発行" }).click()
    await expect(modal.locator(".linkbar")).toBeVisible({ timeout: 30_000 })
    await modal.getByRole("button", { name: "閉じる" }).click()

    const timedChip = page.locator(".lens").getByRole("button", { name: /期限つき/ })
    await expect(timedChip.locator(".num")).toHaveText("1")

    await openRowMenu(page, name)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "名前を変更" }).click()
    const renameModal = page.getByRole("dialog", { name: "名前を変更" })
    await renameModal.getByLabel("新しい名前").fill(renamed)
    await renameModal.getByRole("button", { name: "変更" }).click()

    await expect(getRow(page, renamed)).toBeVisible({ timeout: 15_000 })
    await expect(timedChip.locator(".num")).toHaveText("0", { timeout: 15_000 })
    await expect(getRow(page, renamed).locator(".c-pub .tag.warn")).toHaveCount(0)

    const stored = await page.evaluate(() => sessionStorage.getItem("kura.presigned"))
    expect(stored === null || !stored.includes(name)).toBe(true)
  })

  test("S-PRESIGN-04: 削除すると presign の記録が落ちて lens も戻る", async ({ page }) => {
    const name = uniqueName("presign04")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "presign04")

    const modal = await openPresignModalFromRow(page, name)
    await modal.getByRole("button", { name: "リンクを発行" }).click()
    await expect(modal.locator(".linkbar")).toBeVisible({ timeout: 30_000 })
    await modal.getByRole("button", { name: "閉じる" }).click()

    const timedChip = page.locator(".lens").getByRole("button", { name: /期限つき/ })
    await expect(timedChip.locator(".num")).toHaveText("1")

    await openRowMenu(page, name)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "削除" }).click()
    await page.getByRole("dialog", { name: "ファイルを削除" })
      .getByRole("button", { name: "削除", exact: true }).click()

    await expect(getRow(page, name)).toHaveCount(0, { timeout: 15_000 })
    await expect(timedChip.locator(".num")).toHaveText("0", { timeout: 15_000 })

    const stored = await page.evaluate(() => sessionStorage.getItem("kura.presigned"))
    expect(stored === null || !stored.includes(name)).toBe(true)
  })
})
