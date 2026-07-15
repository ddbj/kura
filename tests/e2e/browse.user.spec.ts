// BROWSE Domain (scenarios.md §BROWSE): breadcrumb / directory 遷移 /
// SPA URL 直打ち / empty state / .keep 非表示。
import { randomBytes } from "node:crypto"

import { expect } from "@playwright/test"

import {
  clearClientPrefs,
  createFolderViaSdk,
  resetE2eScope,
  runId,
  scopeBrowseUrl,
  uniqueFolder,
} from "./_helpers"
import { test } from "./fixtures"

test.describe("BROWSE", () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    void testInfo
    // Playwright fixture 制約 (v2-adversarial A-16): beforeAll では page fixture が
    // 受け取れないので、自前で context + addInitScript で SPA sessionStorage を復元
    const { readFileSync } = await import("node:fs")
    const session = readFileSync("tests/e2e/.auth/user.session.json", "utf8")
    const ctx = await browser.newContext({ storageState: "tests/e2e/.auth/user.storage.json" })
    await ctx.addInitScript((raw: string) => {
      const data = JSON.parse(raw) as Record<string, string>
      for (const [k, v] of Object.entries(data)) sessionStorage.setItem(k, v)
    }, session)
    const page = await ctx.newPage()
    await page.goto("/")
    await expect(page.locator(".hdr")).toBeVisible({ timeout: 15_000 })
    await resetE2eScope(page)
    await ctx.close()
  })

  test.afterEach(async ({ page }) => {
    await clearClientPrefs(page).catch(() => undefined)
  })

  test("S-BROWSE-01: runId scope で empty state が表示される", async ({ page }) => {
    await page.goto(scopeBrowseUrl())
    await expect(page.locator(".pathbar .crumb .cur")).toHaveText(runId(), { timeout: 15_000 })
    await expect(page.locator(".emptyzone .ez-title")).toHaveText("まだファイルがありません")
    await expect(page.locator(".emptyzone .ez-actions").getByRole("button", { name: "アップロード" })).toBeVisible()
  })

  test("S-BROWSE-02: 新規フォルダを作ると .keep は非表示、folder 行だけ", async ({ page }) => {
    const folder = uniqueFolder("browse02")
    await page.goto(scopeBrowseUrl())

    await page.getByRole("button", { name: "＋ 新規フォルダ" }).click()
    const modal = page.getByRole("dialog", { name: "新しいフォルダ" })
    await expect(modal).toBeVisible()
    await modal.getByLabel("フォルダ名").fill(folder)
    await modal.getByRole("button", { name: "作成" }).click()
    await expect(modal).toHaveCount(0)

    const folderRow = page.locator(".row.sel").filter({ hasText: folder }).filter({ has: page.locator(".nm.folder") })
    await expect(folderRow).toBeVisible({ timeout: 10_000 })

    // .keep marker file は render されない
    await page.goto(`/_browse/e2e/${runId()}/${folder}/`)
    await expect(page.locator(".row.sel").filter({ hasText: ".keep" })).toHaveCount(0)
  })

  test("S-BROWSE-03: フォルダクリックでサブディレクトリに入り、breadcrumb が延びる", async ({ page }) => {
    const folder = uniqueFolder("browse03")
    await createFolderViaSdk(page, `e2e/${runId()}/${folder}`)
    await page.goto(scopeBrowseUrl())

    const folderRow = page.locator(".row.sel").filter({ hasText: folder }).filter({ has: page.locator(".nm.folder") })
    await expect(folderRow).toBeVisible({ timeout: 10_000 })
    await folderRow.getByRole("button", { name: folder, exact: true }).click()

    await page.waitForURL(new RegExp(`/_browse/e2e/${runId()}/${folder}/`), { timeout: 10_000 })
    await expect(page.locator(".pathbar .crumb .cur")).toHaveText(folder)
    await expect(page.locator(".emptyzone")).toBeVisible()
  })

  test("S-BROWSE-04: breadcrumb の中間 crumb で親に戻る", async ({ page }) => {
    const parent = uniqueFolder("browse04parent")
    const child = uniqueFolder("browse04child")
    await createFolderViaSdk(page, `e2e/${runId()}/${parent}/${child}`)
    await page.goto(`/_browse/e2e/${runId()}/${parent}/${child}/`)
    await expect(page.locator(".pathbar .crumb .cur")).toHaveText(child)

    await page.locator(".pathbar .crumb").getByRole("link", { name: parent }).click()
    await page.waitForURL(new RegExp(`/_browse/e2e/${runId()}/${parent}/$`))
    await expect(page.locator(".pathbar .crumb .cur")).toHaveText(parent)
  })

  test("S-BROWSE-05: ブラウザ戻る / 進むが SPA history と整合", async ({ page }) => {
    const parent = uniqueFolder("browse05parent")
    const child = uniqueFolder("browse05child")
    await createFolderViaSdk(page, `e2e/${runId()}/${parent}/${child}`)

    await page.goto(`/_browse/e2e/${runId()}/${parent}/`)
    await expect(page.locator(".pathbar .crumb .cur")).toHaveText(parent)

    const childRow = page.locator(".row.sel").filter({ hasText: child }).filter({ has: page.locator(".nm.folder") })
    await childRow.getByRole("button", { name: child, exact: true }).click()
    await expect(page.locator(".pathbar .crumb .cur")).toHaveText(child)

    await page.goBack()
    await expect(page.locator(".pathbar .crumb .cur")).toHaveText(parent)

    await page.goForward()
    await expect(page.locator(".pathbar .crumb .cur")).toHaveText(child)
  })

  test("S-BROWSE-06: URL 直打ちで深い prefix に遷移", async ({ page }) => {
    const parent = uniqueFolder("browse06parent")
    const child = uniqueFolder("browse06child")
    await createFolderViaSdk(page, `e2e/${runId()}/${parent}/${child}`)

    await page.goto(`/_browse/e2e/${runId()}/${parent}/${child}/`)
    await expect(page.locator(".pathbar .crumb .cur")).toHaveText(child)
    await expect(page.locator(".pathbar .crumb").getByRole("link", { name: parent })).toBeVisible()
    await expect(page.locator(".emptyzone")).toBeVisible()
  })

  test("E-BROWSE-01: 存在しない prefix を直打ちしても空 folder として表示される", async ({ page }) => {
    const missing = `never-existed-${randomBytes(4).toString("hex")}`
    await page.goto(`/_browse/e2e/${runId()}/${missing}/`)
    await expect(page.locator(".pathbar .crumb .cur")).toHaveText(missing)
    await expect(page.locator(".emptyzone")).toBeVisible()
    await expect(page.locator(".row.sel")).toHaveCount(0)
  })
})
