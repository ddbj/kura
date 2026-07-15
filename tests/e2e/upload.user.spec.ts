/// <reference lib="dom" />
// UPLOAD Domain (scenarios.md §UPLOAD): file / folder / drag & drop / cancel /
// conflict / retry。auto-dismiss race を吸収するため expectUploadRowAutoDismissed
// を使用。
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect } from "@playwright/test"

import {
  clearClientPrefs,
  delayUploadPart,
  e2eUsername,
  expectUploadDone,
  expectUploadRowAutoDismissed,
  getRow,
  makeMediumBinaryFile,
  openUploadMenu,
  pickFileMenuInput,
  pickFolderMenuInput,
  scopeBrowseUrl,
  scopePrefix,
  stallPutObject,
  uniqueName,
  uploadFileFromPath,
  uploadTextFile,
} from "./_helpers"
import { test } from "./fixtures"

test.describe("UPLOAD", () => {
  test.afterEach(async ({ page }) => {
    await clearClientPrefs(page).catch(() => undefined)
  })

  test("S-UPLOAD-01: ファイルを選択 メニューで単一 file を upload", async ({ page }) => {
    const name = uniqueName("upload01")
    await page.goto(scopeBrowseUrl())
    await openUploadMenu(page)
    await page.locator(".uploadmenu").getByRole("menuitem", { name: "ファイルを選択" }).click()
    await pickFileMenuInput(page).setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("hello upload01"),
    })
    await expectUploadDone(page, name)
    await expect(getRow(page, name)).toBeVisible()
    await expectUploadRowAutoDismissed(page, name)
  })

  test("S-UPLOAD-02: emptyzone の primary button で upload", async ({ page }) => {
    // 同一 runId scope の直下は他 test で埋まるため、この test 用の空 sub-scope
    // を用意して navigate する。SPA は存在しない prefix でも empty state を出す
    // (E-BROWSE-01 で担保)。
    const subScope = `${scopeBrowseUrl()}upload02-${Date.now().toString(36)}/`
    await page.goto(subScope)
    const primary = page.locator(".emptyzone .ez-actions").getByRole("button", { name: "アップロード" })
    await expect(primary).toBeVisible({ timeout: 15_000 })

    const name = uniqueName("upload02")
    await primary.click()
    await pickFileMenuInput(page).setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("hello upload02"),
    })
    await expectUploadDone(page, name)
    await expect(getRow(page, name)).toBeVisible()
  })

  test("S-UPLOAD-03: drag & drop で file を upload", async ({ page }) => {
    const name = uniqueName("upload03")
    const content = "drag drop e2e"
    await page.goto(scopeBrowseUrl())
    await page.locator(".wrap").waitFor({ state: "attached", timeout: 15_000 })

    // Playwright は native DnD を simulate しないので、DataTransfer を browser
    // 側で生成し dragover / drop を同じ handle 相手に dispatch する。
    // React の synthetic event が拾えるよう bubbles: true を付ける。
    //
    // 合成した DataTransferItem に対する `webkitGetAsEntry()` は Chromium で
    // null を返し、SPA の directory-walk 経路が空配列で早期 return してしまう
    // (browse-page.tsx onDrop 参照)。prototype 側を落とすことで
    // `typeof item.webkitGetAsEntry === "function"` が false になり、素直な
    // dataTransfer.files 経路に落ちる。
    await page.evaluate(async ({ name, content }) => {
      const wrap = document.querySelector(".wrap")
      if (!wrap) throw new Error("no .wrap element found")
      delete (DataTransferItem.prototype as { webkitGetAsEntry?: unknown }).webkitGetAsEntry
      const dt = new DataTransfer()
      dt.items.add(new File([content], name, { type: "text/plain" }))
      const dispatch = (type: string) => {
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })
        wrap.dispatchEvent(ev)
      }
      dispatch("dragenter")
      dispatch("dragover")
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      dispatch("drop")
    }, { name, content })

    await expectUploadDone(page, name)
    await expect(getRow(page, name)).toBeVisible()
  })

  test("S-UPLOAD-04: フォルダを選択 で subfolder 込みの upload", async ({ page }) => {
    const folderName = `upload04-${Date.now().toString(36)}`
    const dir = await mkdtemp(join(tmpdir(), "kura-e2e-fld-"))
    const rootDir = join(dir, folderName)
    const subDir = join(rootDir, "sub")
    const { mkdir } = await import("node:fs/promises")
    await mkdir(subDir, { recursive: true })
    const leafName = "leaf.txt"
    await writeFile(join(subDir, leafName), "sub-leaf-content")
    try {
      await page.goto(scopeBrowseUrl())
      await openUploadMenu(page)
      await page.locator(".uploadmenu").getByRole("menuitem", { name: "フォルダを選択" }).click()
      await pickFolderMenuInput(page).setInputFiles(rootDir)
      await expectUploadDone(page, leafName, { timeout: 60_000 })

      // uploads.tsx enqueue が webkitRelativePath を使って ${prefix}${folderName}/sub/leaf.txt
      // で put するようになったので、root に ${folderName}/ の folder 行が現れる。
      const folderRow = page.locator(".row.sel").filter({ hasText: folderName }).filter({ has: page.locator(".nm.folder") })
      await expect(folderRow).toBeVisible({ timeout: 10_000 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("S-UPLOAD-05: upload row の キャンセル で running upload を停止", async ({ page }) => {
    const { path, name, cleanup } = await makeMediumBinaryFile(10, 0x33)
    try {
      await page.goto(scopeBrowseUrl())
      // 10 MiB は localhost で 1s 未満で完走しがち。UploadPart を 3s 遅らせて
      // cancel button を押せる時間を確保する (unroute しないため 2 parts * 3s
      // = 6s は最低かかる)。
      await delayUploadPart(page, { delayMs: 3_000 })

      // AbortMultipartUpload は `DELETE /${bucket}/${key}?uploadId=...`。
      // 実 URL は "?uploadId=" query を含む。
      const deletePromise = page.waitForRequest(
        (req) => req.method() === "DELETE" && req.url().includes("uploadId="),
        { timeout: 30_000 },
      )

      await uploadFileFromPath(page, path)
      const row = page.locator(".upcard .urow").filter({ hasText: name })
      const cancelBtn = row.getByRole("button", { name: "キャンセル" })
      await cancelBtn.waitFor({ state: "visible", timeout: 15_000 })
      await cancelBtn.click()

      await deletePromise
      // cancel() は abort 完了後に removeOne(id) を呼び row を upcard から削除する
      // (scenarios v3 で明記)。detail text "キャンセル済み" は setTransfers filter に
      // 到達する前に消えるため UI 上には残らない。
      await expect(row).toHaveCount(0, { timeout: 15_000 })

      const bucketRow = page.locator(".row.sel").filter({ hasText: name }).filter({ hasNot: page.locator(".nm.folder") })
      await expect(bucketRow).toHaveCount(0)
    } finally {
      await cleanup()
    }
  })

  test("S-UPLOAD-06: すべてキャンセル で全 active upload を停止", async ({ page }) => {
    const file1 = await makeMediumBinaryFile(10, 0x51)
    const file2 = await makeMediumBinaryFile(10, 0x52)
    try {
      await page.goto(scopeBrowseUrl())
      // 各 UploadPart を 5s 遅らせて、2 本 (running + queued) が同時に upcard に
      // 並ぶ時間を確保する。
      await delayUploadPart(page, { delayMs: 5_000 })

      await uploadFileFromPath(page, file1.path)
      await uploadFileFromPath(page, file2.path)
      // 2 row 分の upload が upcard に並ぶ (MAX_CONCURRENT=1: 一方は running / 他方は queued / checking いずれか)
      await expect(page.locator(".upcard .urow").filter({ hasText: /bin-10mib-/ }))
        .toHaveCount(2, { timeout: 30_000 })

      await page.locator(".upcard .uph").getByRole("button", { name: "すべてキャンセル" }).click()

      // cancelAll() は uploading/done 以外を drop するので upcard から
      // 該当 row が消える。tag.run も 0 件。
      await expect(page.locator(".upcard .urow").filter({ hasText: /bin-10mib-/ }))
        .toHaveCount(0, { timeout: 30_000 })
      // bucket 一覧にも該当 file は現れない
      await expect(page.locator(".row.sel").filter({ hasText: file1.name })).toHaveCount(0)
      await expect(page.locator(".row.sel").filter({ hasText: file2.name })).toHaveCount(0)
    } finally {
      await file1.cleanup()
      await file2.cleanup()
    }
  })

  test("E-UPLOAD-01: 同名 conflict → スキップ", async ({ page }) => {
    const name = uniqueName("dup01")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "first")
    await expectUploadRowAutoDismissed(page, name)

    // 2 回目 upload (別内容、同名)
    await openUploadMenu(page)
    await page.locator(".uploadmenu").getByRole("menuitem", { name: "ファイルを選択" }).click()
    await pickFileMenuInput(page).setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("second"),
    })

    const row = page.locator(".upcard .urow").filter({ hasText: name })
    await expect(row.locator(".tag.warn")).toHaveText("衝突", { timeout: 15_000 })

    await row.getByRole("button", { name: "スキップ" }).click()
    await expect(row).toHaveCount(0, { timeout: 10_000 })

    // ダウンロードして content が "first" のままであること
    const download = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await getRow(page, name).getByRole("button", { name: `${name} の操作` }).click()
        await page.locator(".rowmenu").getByRole("menuitem", { name: "ダウンロード" }).click()
      })(),
    ]).then(([d]) => d)
    const path = await download.path()
    const { readFileSync } = await import("node:fs")
    expect(readFileSync(path, "utf8")).toBe("first")
  })

  test("E-UPLOAD-02: 同名 conflict → 上書き", async ({ page }) => {
    const name = uniqueName("dup02")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "first")
    await expectUploadRowAutoDismissed(page, name)

    await openUploadMenu(page)
    await page.locator(".uploadmenu").getByRole("menuitem", { name: "ファイルを選択" }).click()
    await pickFileMenuInput(page).setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("second"),
    })

    const row = page.locator(".upcard .urow").filter({ hasText: name })
    await expect(row.locator(".tag.warn")).toHaveText("衝突", { timeout: 15_000 })
    await row.getByRole("button", { name: "上書き" }).click()

    await expectUploadDone(page, name)
    const download = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await getRow(page, name).getByRole("button", { name: `${name} の操作` }).click()
        await page.locator(".rowmenu").getByRole("menuitem", { name: "ダウンロード" }).click()
      })(),
    ]).then(([d]) => d)
    const path = await download.path()
    const { readFileSync } = await import("node:fs")
    expect(readFileSync(path, "utf8")).toBe("second")
  })

  test("E-UPLOAD-03: 同名 conflict → 別名で保存", async ({ page }) => {
    const name = uniqueName("dup03")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "first")
    await expectUploadRowAutoDismissed(page, name)

    await openUploadMenu(page)
    await page.locator(".uploadmenu").getByRole("menuitem", { name: "ファイルを選択" }).click()
    await pickFileMenuInput(page).setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("second"),
    })

    const row = page.locator(".upcard .urow").filter({ hasText: name })
    await expect(row.locator(".tag.warn")).toHaveText("衝突", { timeout: 15_000 })
    await row.getByRole("button", { name: "別名で保存" }).click()

    // 元 file 残る、別名 file (suggestSaveAsName で "(1).txt" 付与) 追加
    await expect(getRow(page, name)).toBeVisible()
    const stem = name.replace(/\.txt$/, "")
    const altPattern = new RegExp(`${stem}.*\\.txt`)
    const altRow = page.locator(".row.sel").filter({ hasText: altPattern }).filter({ hasNot: page.locator(".nm.folder") })
    await expect(altRow).toHaveCount(2, { timeout: 15_000 })
  })

  test("E-UPLOAD-04: 失敗した upload の 再試行 (small file 経路)", async ({ page }) => {
    const name = uniqueName("retry04")
    await page.goto(scopeBrowseUrl())
    const key = `${scopePrefix()}${name}`

    // failCount のデフォルトは 5 で AWS SDK v3 の maxAttempts=3 (1 initial +
    // 2 retries) を超える。1 回目の 500 だけを返しても SDK 内で retry されて
    // upload 全体は成功し .tag.fail が出ない。
    await stallPutObject(page, { bucket: e2eUsername(), key })

    await openUploadMenu(page)
    await page.locator(".uploadmenu").getByRole("menuitem", { name: "ファイルを選択" }).click()
    await pickFileMenuInput(page).setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("retry me"),
    })

    const row = page.locator(".upcard .urow").filter({ hasText: name })
    await expect(row.locator(".tag.fail")).toHaveText("失敗", { timeout: 30_000 })

    // intercept 解除
    await page.unroute("**/*")

    // 再試行 button (small file 経路なので "再試行"、multipart なら "再開")
    await row.getByRole("button", { name: "再試行" }).click()
    await expectUploadDone(page, name)
  })
})
