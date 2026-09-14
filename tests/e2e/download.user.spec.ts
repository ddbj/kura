// DOWNLOAD Domain (scenarios.md §DOWNLOAD): row menu の「ダウンロード」経路。
// suggestedFilename の UTF-8 round trip と byte 一致を pin する。
import { readFileSync } from "node:fs"

import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

import {
  clearClientPrefs,
  createFolderViaSdk,
  getFolderRow,
  getRow,
  openFolderMenu,
  openRowMenu,
  openUploadMenu,
  pickFileMenuInput,
  runId,
  scopeBrowseUrl,
  uniqueFolder,
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

  // 無圧縮 (store) なので、entry 名も中身も zip の中に平文で並ぶ
  const zipContains = (bytes: Buffer, needle: string): boolean =>
    bytes.includes(Buffer.from(needle, "utf8"))

  test("S-DOWNLOAD-03: 複数選択を zip でまとめて download", async ({ page }) => {
    const first = uniqueName("dl03-a")
    const second = uniqueName("dl03-b")
    await uploadInline(page, first, Buffer.from("first-payload"))
    await uploadInline(page, second, Buffer.from("second-payload"))

    await page.getByRole("checkbox", { name: `${first} を選択` }).check()
    await page.getByRole("checkbox", { name: `${second} を選択` }).check()

    const download = await Promise.all([
      page.waitForEvent("download"),
      page.locator('.card:not(:has([data-testid="pending-uploads"])) .bulkbar')
        .getByRole("button", { name: "zip でダウンロード" }).click(),
    ]).then(([d]) => d)

    expect(download.suggestedFilename()).toBe(`${runId()}.zip`)
    const bytes = Buffer.from(readFileSync(await download.path()))
    expect(bytes.subarray(0, 2).toString("utf8")).toBe("PK")
    expect(zipContains(bytes, first)).toBe(true)
    expect(zipContains(bytes, second)).toBe(true)
    expect(zipContains(bytes, "first-payload")).toBe(true)
    expect(zipContains(bytes, "second-payload")).toBe(true)
  })

  test("S-DOWNLOAD-04: folder を zip で download (相対パスと空 folder を保つ)", async ({ page }) => {
    const folder = uniqueFolder("dl04")
    const inner = "nested.txt"
    await createFolderViaSdk(page, `e2e/${runId()}/${folder}`)
    await createFolderViaSdk(page, `e2e/${runId()}/${folder}/empty-child`)
    await page.goto(`/browse/e2e/${runId()}/${folder}/`)
    await openUploadMenu(page)
    await page.locator(".uploadmenu").getByRole("menuitem", { name: "ファイルを選択" }).click()
    await pickFileMenuInput(page).setInputFiles({
      name: inner,
      mimeType: "text/plain",
      buffer: Buffer.from("nested-payload"),
    })
    await expect(getRow(page, inner)).toBeVisible({ timeout: 30_000 })

    await page.goto(scopeBrowseUrl())
    await expect(getFolderRow(page, folder)).toBeVisible({ timeout: 15_000 })

    const download = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await openFolderMenu(page, folder)
        await page.locator(".rowmenu").getByRole("menuitem", { name: "zip でダウンロード" }).click()
      })(),
    ]).then(([d]) => d)

    expect(download.suggestedFilename()).toBe(`${folder}.zip`)
    const bytes = Buffer.from(readFileSync(await download.path()))
    expect(bytes.subarray(0, 2).toString("utf8")).toBe("PK")
    // folder 内の相対パスで入る (folder 名は zip 名が担う)
    expect(zipContains(bytes, inner)).toBe(true)
    expect(zipContains(bytes, "nested-payload")).toBe(true)
    // 空 folder は folder entry として残る。.keep そのものは入らない
    expect(zipContains(bytes, "empty-child/")).toBe(true)
    expect(zipContains(bytes, ".keep")).toBe(false)
  })
})
