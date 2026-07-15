// TOOLBAR Domain (scenarios.md §TOOLBAR): search / lens / sort / quota bar。
// serial 化 (self-contained だが lens / search の state carry over 回避のため)。
import { expect } from "@playwright/test"

import {
  clearClientPrefs,
  getRow,
  openPresignModalFromRow,
  scopeBrowseUrl,
  uniqueName,
  uploadTextFile,
} from "./_helpers"
import { test } from "./fixtures"

test.describe("TOOLBAR", () => {
  test.describe.configure({ mode: "serial" })

  test.afterEach(async ({ page }) => {
    await clearClientPrefs(page).catch(() => undefined)
  })

  test("S-TOOLBAR-01: 検索で substring 一致 filter", async ({ page }) => {
    const a = uniqueName("tb01-A")
    const b = uniqueName("tb01-B")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, a, "a")
    await uploadTextFile(page, b, "b")

    const search = page.getByLabel("ファイル名で絞り込み")
    await search.fill("tb01-A")
    await expect(getRow(page, a)).toBeVisible()
    await expect(getRow(page, b)).toHaveCount(0)

    await search.fill("")
    await expect(getRow(page, a)).toBeVisible()
    await expect(getRow(page, b)).toBeVisible()
  })

  test("S-TOOLBAR-02: 検索ヒット 0 で「一致するファイルはありません」→ 検索をクリアで復帰", async ({ page }) => {
    const name = uniqueName("tb02")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "x")

    const needle = `zzz-no-match-${Date.now().toString(36)}`
    const search = page.getByLabel("ファイル名で絞り込み")
    await search.fill(needle)

    const emptyScope = page.locator(".empty")
    await expect(emptyScope.getByRole("heading")).toContainText(`「${needle}」に一致するファイルはありません`)

    await emptyScope.getByRole("button", { name: "検索をクリア" }).click()
    await expect(search).toHaveValue("")
    await expect(getRow(page, name)).toBeVisible()
  })

  test("S-TOOLBAR-03: lens 公開中 で公開 file のみに絞る", async ({ page }) => {
    const a = uniqueName("tb03-A")
    const b = uniqueName("tb03-B")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, a, "a")
    await uploadTextFile(page, b, "b")

    // publish file A only via ShareModal(pub)
    await getRow(page, a).locator(".pubbtn").click()
    const shareModal = page.getByRole("dialog", { name: "ファイルを公開" })
    await expect(shareModal).toBeVisible()
    await shareModal.getByRole("button", { name: "公開する" }).click()
    await expect(shareModal.locator(".flist .tag.ok")).toHaveText("完了", { timeout: 15_000 })
    await shareModal.getByRole("button", { name: "閉じる" }).click()

    await expect(getRow(page, a).locator(".c-pub .tag.ok")).toHaveText("公開中", { timeout: 10_000 })

    const publicChip = page.locator(".lens").getByRole("button", { name: /公開中/ })
    await publicChip.click()
    await expect(publicChip).toHaveAttribute("aria-pressed", "true")
    // 非選択 chip は aria-pressed 属性を持たない (chip.tsx: undefined when inactive)
    await expect(page.locator(".lens").getByRole("button", { name: /すべて/ })).not.toHaveAttribute("aria-pressed", "true")

    await expect(getRow(page, a)).toBeVisible()
    await expect(getRow(page, b)).toHaveCount(0)
  })

  test("S-TOOLBAR-04: lens 期限つき で presigned のみ", async ({ page }) => {
    const name = uniqueName("tb04")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "x")
    await page.locator(".upcard .urow").filter({ hasText: name }).waitFor({ state: "detached", timeout: 15_000 })

    const modal = await openPresignModalFromRow(page, name)
    await modal.getByRole("button", { name: "リンクを発行" }).click()
    // 発行成功後は modal footer が単一 "閉じる" に切り替わる
    await expect(modal.getByRole("button", { name: "閉じる" })).toBeVisible({ timeout: 15_000 })
    await modal.getByRole("button", { name: "閉じる" }).click()

    await expect(getRow(page, name).locator(".c-pub .tag.warn")).toHaveText("期限つき", { timeout: 10_000 })

    const timedChip = page.locator(".lens").getByRole("button", { name: /期限つき/ })
    await timedChip.click()
    await expect(timedChip).toHaveAttribute("aria-pressed", "true")
    await expect(getRow(page, name)).toBeVisible()
  })

  test("S-TOOLBAR-05: sort カラムで並び順が変わる", async ({ page }) => {
    const a = uniqueName("tb05-a")
    const b = uniqueName("tb05-b")
    const c = uniqueName("tb05-c")
    await page.goto(scopeBrowseUrl())
    // Reverse-order sizes so name-desc and size-desc give different first rows.
    await uploadTextFile(page, a, "big".repeat(200))
    await uploadTextFile(page, b, "med".repeat(20))
    await uploadTextFile(page, c, "x")

    const nameSort = page.locator(".thead").getByRole("button", { name: /^名前/ })
    await nameSort.click()
    // 単に "順序が変わる" ことを検査: 先頭 row の name が 3 件の中で変わったこと
    const firstBefore = await page.locator(".row.sel:not(:has(.nm.folder))").first().textContent()

    const sizeSort = page.locator(".thead").getByRole("button", { name: /^サイズ/ })
    await sizeSort.click()
    await expect(sizeSort).toHaveClass(/\bdesc\b|\bon\b/)
    const firstAfter = await page.locator(".row.sel:not(:has(.nm.folder))").first().textContent()
    expect(firstAfter, "sort by size should reorder rows").not.toBe(firstBefore)
  })

  test("S-TOOLBAR-06: quota bar の可視", async ({ page }) => {
    await page.goto("/")
    const quota = page.locator(".toolbar .quota")
    await expect(quota).toBeVisible()
    await expect(quota).toContainText("使用量")
    await expect(quota.locator("b")).toBeVisible()
    await expect(page.locator(".banner.red")).toHaveCount(0)
  })
})
