// RESUME Domain (scenarios.md §RESUME): 中断された multipart upload を同一
// session / 別 context / 同 context reload から再開する経路と、mismatch reject /
// 破棄。32 MiB (4 parts) 前提。
import { readFileSync } from "node:fs"

import { expect } from "@playwright/test"

import {
  clearClientPrefs,
  expectUploadDone,
  getRow,
  makeMediumBinaryFile,
  openUploadMenu,
  pickFileMenuInput,
  pickPendingResumeInput,
  preparePendingUpload,
  scopeBrowseUrl,
  scopePrefix,
  stallUploadPart,
  uniqueName,
} from "./_helpers"
import { test } from "./fixtures"

const AUTH_STORAGE = "tests/e2e/.auth/user.storage.json"

const partRoute = /\?partNumber=\d+.*uploadId=/

test.describe("RESUME", () => {
  test.afterEach(async ({ page }) => {
    await clearClientPrefs(page).catch(() => undefined)
  })

  test("S-RESUME-01: 同一セッションで UploadPart stall → 再開 → byte 一致", async ({ page }) => {
    const { path, name, buffer, cleanup } = await makeMediumBinaryFile(32, 0x11)
    try {
      await page.goto(scopeBrowseUrl())
      await stallUploadPart(page)

      await openUploadMenu(page)
      await page.locator(".uploadmenu").getByRole("menuitem", { name: "ファイルを選択" }).click()
      await pickFileMenuInput(page).setInputFiles(path)

      const row = page.locator(".upcard .urow").filter({ hasText: name })
      await expect(row.locator(".tag.fail")).toHaveText("失敗", { timeout: 60_000 })
      const resumeBtn = row.getByRole("button", { name: "再開" })
      await expect(resumeBtn).toBeVisible({ timeout: 5_000 })

      await page.unroute(partRoute)

      await resumeBtn.click()
      await expectUploadDone(page, name, { timeout: 120_000 })

      const download = await Promise.all([
        page.waitForEvent("download"),
        (async () => {
          await getRow(page, name).getByRole("button", { name: `${name} の操作` }).click()
          await page.locator(".rowmenu").getByRole("menuitem", { name: "ダウンロード" }).click()
        })(),
      ]).then(([d]) => d)
      const downloadPath = await download.path()
      expect(Buffer.from(readFileSync(downloadPath)).equals(buffer)).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test("S-RESUME-02: 別 context で再ログイン後の resume — pending-uploads card から復元", async ({ browser, page }) => {
    const { path, name, buffer, cleanup } = await makeMediumBinaryFile(32, 0x22)
    try {
      // context1: fixture が提供する page で失敗まで持っていく。
      await page.goto(scopeBrowseUrl())
      await stallUploadPart(page)
      await openUploadMenu(page)
      await page.locator(".uploadmenu").getByRole("menuitem", { name: "ファイルを選択" }).click()
      await pickFileMenuInput(page).setInputFiles(path)
      const row = page.locator(".upcard .urow").filter({ hasText: name })
      await expect(row.locator(".tag.fail")).toHaveText("失敗", { timeout: 60_000 })

      // context1 の sessionStorage snapshot を close 直前に取る (OIDC token
      // が silent renew で更新されている可能性があるため、fixture 経由の元
      // snapshot ではなく実状態を注入する。scenarios v3)。
      const sessionSnapshot = await page.evaluate(() => {
        const out: Record<string, string> = {}
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i)
          if (k === null) continue
          const v = sessionStorage.getItem(k)
          if (v !== null) out[k] = v
        }
        return JSON.stringify(out)
      })
      await page.context().close()

      const context2 = await browser.newContext({ storageState: AUTH_STORAGE })
      await context2.addInitScript((raw: string) => {
        const data = JSON.parse(raw) as Record<string, string>
        for (const [k, v] of Object.entries(data)) sessionStorage.setItem(k, v)
      }, sessionSnapshot)
      const page2 = await context2.newPage()
      try {
        // pending card は listPendingUploads(bucket, prefix) が prefix scope で
        // 走るので、我 runId scope に navigate して他 run のゴミを除外する。
        await page2.goto(scopeBrowseUrl())
        const pendingCard = page2.locator('[data-testid="pending-uploads"]')
        await expect(pendingCard).toBeVisible({ timeout: 30_000 })
        const pendingRow = pendingCard.locator(".row.nosel").filter({ hasText: name })
        await expect(pendingRow).toBeVisible({ timeout: 15_000 })

        await pendingRow.getByRole("button", { name: "再開" }).click()
        await pickPendingResumeInput(page2).setInputFiles(path)

        await expectUploadDone(page2, name, { timeout: 120_000 })

        // byte-check via download
        const download = await Promise.all([
          page2.waitForEvent("download"),
          (async () => {
            await getRow(page2, name).getByRole("button", { name: `${name} の操作` }).click()
            await page2.locator(".rowmenu").getByRole("menuitem", { name: "ダウンロード" }).click()
          })(),
        ]).then(([d]) => d)
        const downloadPath = await download.path()
        expect(Buffer.from(readFileSync(downloadPath)).equals(buffer)).toBe(true)
      } finally {
        await context2.close()
      }
    } finally {
      await cleanup()
    }
  })

  test("S-RESUME-03: 同 context で reload → pending-uploads card から復元", async ({ page }) => {
    const { path, name, buffer, cleanup } = await makeMediumBinaryFile(32, 0x33)
    try {
      await page.goto(scopeBrowseUrl())
      await stallUploadPart(page)
      await openUploadMenu(page)
      await page.locator(".uploadmenu").getByRole("menuitem", { name: "ファイルを選択" }).click()
      await pickFileMenuInput(page).setInputFiles(path)
      const row = page.locator(".upcard .urow").filter({ hasText: name })
      await expect(row.locator(".tag.fail")).toHaveText("失敗", { timeout: 60_000 })

      await page.unroute(partRoute)
      await page.reload()

      const pendingCard = page.locator('[data-testid="pending-uploads"]')
      await expect(pendingCard).toBeVisible({ timeout: 30_000 })
      const pendingRow = pendingCard.locator(".row.nosel").filter({ hasText: name })
      await expect(pendingRow).toBeVisible({ timeout: 15_000 })

      await pendingRow.getByRole("button", { name: "再開" }).click()
      await pickPendingResumeInput(page).setInputFiles(path)

      await expectUploadDone(page, name, { timeout: 120_000 })

      const download = await Promise.all([
        page.waitForEvent("download"),
        (async () => {
          await getRow(page, name).getByRole("button", { name: `${name} の操作` }).click()
          await page.locator(".rowmenu").getByRole("menuitem", { name: "ダウンロード" }).click()
        })(),
      ]).then(([d]) => d)
      const downloadPath = await download.path()
      expect(Buffer.from(readFileSync(downloadPath)).equals(buffer)).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test("E-RESUME-01: 別内容の同一サイズ file で再開 → mismatch reject", async ({ page }) => {
    // 事前準備: SDK で 32 MiB, 4 parts の pending upload を作り parts 1-2
    // だけ upload 済み (verifyCompletedParts が ETag mismatch を検知するため
    // 最低 1 part 必要)。stallUploadPart 経由だと SDK retry の関係で
    // completed parts が決まらないので直接 SDK 経路を使う (scenarios v3)。
    const name = uniqueName("mismatch01", "bin")
    const key = `${scopePrefix()}${name}`
    const { buffer } = await preparePendingUpload(page, {
      key,
      sizeMiB: 32,
      uploadedParts: [1, 2],
      seed: 0x44,
    })
    // 中身違い / 同一サイズ の file を tmp に書く
    const mismatched = await makeMediumBinaryFile(32, 0x99)
    expect(mismatched.buffer.length).toBe(buffer.length)
    try {
      await page.goto(scopeBrowseUrl())
      const pendingCard = page.locator('[data-testid="pending-uploads"]')
      await expect(pendingCard).toBeVisible({ timeout: 30_000 })
      const pendingRow = pendingCard.locator(".row.nosel").filter({ hasText: name })
      await expect(pendingRow).toBeVisible({ timeout: 15_000 })

      await pendingRow.getByRole("button", { name: "再開" }).click()
      await pickPendingResumeInput(page).setInputFiles(mismatched.path)

      // planResume は size のみ検査。content mismatch は resumeUpload 内の
      // verifyCompletedParts が投げ、transfer が state=failed error="content mismatch"
      // (detail text `内容が一致しません`) になる。flash `再開できません` は size
      // mismatch のときのみ (upload-card.tsx:86 / browse-page.tsx:498 参照)。
      const failedRow = page.locator(".upcard .urow").filter({ hasText: "内容が一致しません" })
      await expect(failedRow).toBeVisible({ timeout: 30_000 })
    } finally {
      await mismatched.cleanup()
      // pending upload の掃除は Domain 全体で run 終了時 (別 run の cleanup
      // helper) or 手動 scripts/e2e-cleanup.ts に委ねる。
    }
  })

  test("E-RESUME-02: pending upload を 破棄 で消せる", async ({ page }) => {
    const name = uniqueName("discard02", "bin")
    const key = `${scopePrefix()}${name}`
    await preparePendingUpload(page, {
      key,
      sizeMiB: 32,
      uploadedParts: [1],
      seed: 0x55,
    })
    await page.goto(scopeBrowseUrl())
    const pendingCard = page.locator('[data-testid="pending-uploads"]')
    await expect(pendingCard).toBeVisible({ timeout: 30_000 })
    const pendingRow = pendingCard.locator(".row.nosel").filter({ hasText: name })
    await expect(pendingRow).toBeVisible({ timeout: 15_000 })

    const deletePromise = page.waitForRequest(
      (req) => req.method() === "DELETE" && req.url().includes("uploadId=") && req.url().includes(name),
      { timeout: 30_000 },
    )
    await pendingRow.getByRole("button", { name: "破棄" }).click()

    await deletePromise
    const status = page.locator('[role="status"]').filter({ hasText: "破棄しました" })
    await expect(status).toBeVisible({ timeout: 10_000 })
    await expect(pendingRow).toHaveCount(0, { timeout: 15_000 })
  })
})

