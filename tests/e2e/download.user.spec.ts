// DOWNLOAD Domain (scenarios.md §DOWNLOAD): row menu の「ダウンロード」経路。
// suggestedFilename の UTF-8 round trip と byte 一致を pin する。
import { readFileSync } from "node:fs"

import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

import {
  clearClientPrefs,
  getRow,
  openRowMenu,
  openUploadMenu,
  pickFileMenuInput,
  scopeBrowseUrl,
  uniqueName,
} from "./_helpers"
import { test } from "./fixtures"

test.describe("DOWNLOAD", () => {
  test.afterEach(async ({ page }) => {
    await clearClientPrefs(page).catch(() => undefined)
  })

  const uploadInline = async (page: Page, name: string, buffer: Buffer): Promise<void> => {
    await page.goto(scopeBrowseUrl())
    await openUploadMenu(page)
    await page.locator(".uploadmenu").getByRole("menuitem", { name: "ファイルを選択" }).click()
    await pickFileMenuInput(page).setInputFiles({
      name,
      mimeType: "application/octet-stream",
      buffer,
    })
    await expect(page.locator(".upcard .urow").filter({ hasText: name }).locator(".tag.ok"))
      .toHaveText("完了", { timeout: 30_000 })
    await expect(getRow(page, name)).toBeVisible()
  }

  test("S-DOWNLOAD-01: row menu の ダウンロード で byte 同一取得", async ({ page }) => {
    const name = uniqueName("dl01")
    const content = Buffer.from("byte-identical-download-payload")
    await uploadInline(page, name, content)

    const download = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await openRowMenu(page, name)
        await page.locator(".rowmenu").getByRole("menuitem", { name: "ダウンロード" }).click()
      })(),
    ]).then(([d]) => d)

    expect(download.suggestedFilename()).toBe(name)
    const path = await download.path()
    expect(Buffer.from(readFileSync(path)).equals(content)).toBe(true)
  })

  test("S-DOWNLOAD-02: unicode / space / % / ? / # を含む key を download", async ({ page }) => {
    // encodeFilenameStrict は !*'() まで含めて percent-encode するので、
    // Chromium が Content-Disposition filename*= を UTF-8 に decode する経路を pin。
    const hex = Math.random().toString(16).slice(2, 10)
    const name = `e2e ${hex} 100% 実測 #test.txt`
    const content = Buffer.from("unicode-special-chars-download")
    await uploadInline(page, name, content)

    const download = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await openRowMenu(page, name)
        await page.locator(".rowmenu").getByRole("menuitem", { name: "ダウンロード" }).click()
      })(),
    ]).then(([d]) => d)

    // Playwright は suggestedFilename を UTF-8 decode 後の string で返すが、
    // OS 側で NFD / NFC 差が出ることがあるので normalize("NFC") で比較する。
    expect(download.suggestedFilename().normalize("NFC")).toBe(name.normalize("NFC"))
    const path = await download.path()
    expect(Buffer.from(readFileSync(path)).equals(content)).toBe(true)
  })
})
