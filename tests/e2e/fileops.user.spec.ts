// FILEOPS Domain (scenarios.md §FILEOPS): rename / move / copy / delete
// (single, multi, folder) + new folder + 公開中 file の rename の tag
// carry-over + 検証エラー系。
import { expect } from "@playwright/test"

import {
  clearClientPrefs,
  createFolderViaSdk,
  e2eUsername,
  expandRow,
  expectUploadRowAutoDismissed,
  getAnon,
  getBulkBar,
  getFolderRow,
  getPubPanel,
  getRow,
  openFolderMenu,
  openRowMenu,
  pickerExpandScopePath,
  publicUrlFor,
  scopeBrowseUrl,
  scopePrefix,
  uniqueFolder,
  uniqueName,
  uploadTextFile,
} from "./_helpers"
import { test } from "./fixtures"

test.describe("FILEOPS", () => {
  test.afterEach(async ({ page }) => {
    await clearClientPrefs(page).catch(() => undefined)
  })

  test("S-FILEOPS-01: rename (file)", async ({ page }) => {
    const src = uniqueName("fo01-src")
    const dst = uniqueName("fo01-dst")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, src, "x")
    await expectUploadRowAutoDismissed(page, src)

    await openRowMenu(page, src)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "名前を変更" }).click()

    const modal = page.getByRole("dialog", { name: "名前を変更" })
    const input = modal.getByLabel("新しい名前")
    await expect(input).toHaveValue(src)
    await input.fill(dst)
    await modal.getByRole("button", { name: "変更" }).click()

    await expect(getRow(page, dst)).toBeVisible({ timeout: 15_000 })
    await expect(getRow(page, src)).toHaveCount(0)
    await expectUploadRowAutoDismissed(page, dst)
  })

  test("S-FILEOPS-02: rename (folder)", async ({ page }) => {
    const src = uniqueFolder("fo02-src")
    const dst = uniqueFolder("fo02-dst")
    await createFolderViaSdk(page, `${scopePrefix()}${src}`)
    await page.goto(scopeBrowseUrl())
    await expect(getFolderRow(page, src)).toBeVisible({ timeout: 15_000 })

    await openFolderMenu(page, src)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "名前を変更" }).click()

    const modal = page.getByRole("dialog", { name: "フォルダ名を変更" })
    await modal.getByLabel("新しい名前").fill(dst)
    await modal.getByRole("button", { name: "変更" }).click()

    // .upcard で folder-rename operation の 完了 を待ってから listing 検証。
    // enqueueFolderMove は最後に deleteEmptyDirectory(srcPrefix) を発行して
    // SeaweedFS filer の空 directory entry を削除する (uploads.tsx 参照)。
    await expect(page.locator(".upcard .urow").filter({ hasText: src }).locator(".tag.ok"))
      .toBeVisible({ timeout: 30_000 })
    await expect(getFolderRow(page, dst)).toBeVisible({ timeout: 15_000 })
    await expect(getFolderRow(page, src)).toHaveCount(0, { timeout: 15_000 })
  })

  test("S-FILEOPS-03: move (file) — FolderPicker 経由", async ({ page }) => {
    const src = uniqueName("fo03-file")
    const dstFolder = uniqueFolder("fo03-dst")
    await createFolderViaSdk(page, `${scopePrefix()}${dstFolder}`)
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, src, "move-me")
    await expectUploadRowAutoDismissed(page, src)

    await openRowMenu(page, src)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "移動" }).click()

    const modal = page.getByRole("dialog", { name: new RegExp(`「${src}」を移動`) })
    await modal.getByRole("button", { name: "選ぶ…" }).click()

    const picker = page.getByRole("dialog", { name: "移動先のフォルダを選ぶ" })
    await picker.waitFor({ state: "visible" })
    // picker は root のみ expand で開くため runId scope を掘る必要がある
    await pickerExpandScopePath(picker)
    await picker.locator(".picker-row").filter({ hasText: dstFolder }).first().click()
    await picker.getByRole("button", { name: "選択" }).click()

    // MoveModal 復帰後 submit
    await modal.getByRole("button", { name: "移動" }).click()

    await expect(getRow(page, src)).toHaveCount(0, { timeout: 30_000 })
    await page.goto(`${scopeBrowseUrl()}${dstFolder}/`)
    await expect(getRow(page, src)).toBeVisible({ timeout: 15_000 })
  })

  test("S-FILEOPS-04: copy (file)", async ({ page }) => {
    const src = uniqueName("fo04-src")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, src, "copy-me")
    await expectUploadRowAutoDismissed(page, src)

    await openRowMenu(page, src)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "コピー" }).click()

    const modal = page.getByRole("dialog", { name: "コピー" })
    const input = modal.getByLabel("コピー後の名前")
    const suggested = await input.inputValue()
    expect(suggested).toContain("のコピー")
    expect(suggested).toMatch(/\.txt$/)
    await modal.getByRole("button", { name: "コピー" }).click()

    await expect(getRow(page, src)).toBeVisible()
    await expect(getRow(page, suggested)).toBeVisible({ timeout: 15_000 })
  })

  test("S-FILEOPS-05: delete (single) — confirmation modal + 初期 focus 検証", async ({ page }) => {
    const name = uniqueName("fo05")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "delete-me")
    await expectUploadRowAutoDismissed(page, name)

    await openRowMenu(page, name)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "削除" }).click()

    const modal = page.getByRole("dialog", { name: "ファイルを削除" })
    await modal.waitFor({ state: "visible" })
    const cancel = modal.getByRole("button", { name: "キャンセル" })
    const del = modal.getByRole("button", { name: "削除" })
    // Modal open 時の auto-focus は unit `modal.test.tsx` が担保する。
    // headless Chromium の tab active 状態依存で E2E では flaky なため、
    // ここでは Tab キー移動が想定通り動くかどうか (キャンセル → 削除) を
    // 検証する: cancel に手動 focus → Tab → del が focused。
    await cancel.focus()
    await expect(cancel).toBeFocused({ timeout: 5_000 })
    await page.keyboard.press("Tab")
    await expect(del).toBeFocused()
    await del.click()

    await expect(getRow(page, name)).toHaveCount(0, { timeout: 15_000 })
  })

  test("S-FILEOPS-06: delete (multi) — bulk bar 経由", async ({ page }) => {
    const name1 = uniqueName("fo06-a")
    const name2 = uniqueName("fo06-b")
    const name3 = uniqueName("fo06-c")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name1, "1")
    await uploadTextFile(page, name2, "2")
    await uploadTextFile(page, name3, "3")

    await page.getByRole("checkbox", { name: `${name1} を選択` }).check()
    await page.getByRole("checkbox", { name: `${name2} を選択` }).check()
    const bulk = getBulkBar(page)
    await expect(bulk.locator("b")).toHaveText("2件を選択中")
    await bulk.getByRole("button", { name: "削除" }).click()

    const modal = page.getByRole("dialog", { name: "ファイルを削除" })
    await expect(modal).toContainText("2 件のファイルを削除")
    await modal.getByRole("button", { name: "削除" }).click()

    await expect(getRow(page, name1)).toHaveCount(0, { timeout: 15_000 })
    await expect(getRow(page, name2)).toHaveCount(0, { timeout: 15_000 })
    await expect(getRow(page, name3)).toBeVisible()
  })

  test("S-FILEOPS-07: folder delete (confirmation あり)", async ({ page }) => {
    const folder = uniqueFolder("fo07")
    const inside = uniqueName("fo07-file")
    await createFolderViaSdk(page, `${scopePrefix()}${folder}`)
    await page.goto(`${scopeBrowseUrl()}${folder}/`)
    await uploadTextFile(page, inside, "inside")
    await expectUploadRowAutoDismissed(page, inside)

    await page.goto(scopeBrowseUrl())
    await expect(getFolderRow(page, folder)).toBeVisible({ timeout: 15_000 })
    await openFolderMenu(page, folder)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "削除" }).click()

    const modal = page.getByRole("dialog", { name: "フォルダを削除" })
    await expect(modal).toContainText(`フォルダ「${folder}」`)
    await modal.getByRole("button", { name: "削除" }).click()

    await expect(getFolderRow(page, folder)).toHaveCount(0, { timeout: 30_000 })
    // 中の file も消えている (深い遷移してから確認)
    await page.goto(`${scopeBrowseUrl()}${folder}/`)
    await expect(getRow(page, inside)).toHaveCount(0, { timeout: 15_000 })
  })

  test("S-FILEOPS-08: folder move", async ({ page }) => {
    const src = uniqueFolder("fo08-src")
    const dst = uniqueFolder("fo08-dst")
    const inside = uniqueName("fo08-file")
    await createFolderViaSdk(page, `${scopePrefix()}${src}`)
    await createFolderViaSdk(page, `${scopePrefix()}${dst}`)
    await page.goto(`${scopeBrowseUrl()}${src}/`)
    await uploadTextFile(page, inside, "moveme")
    await expectUploadRowAutoDismissed(page, inside)

    await page.goto(scopeBrowseUrl())
    await openFolderMenu(page, src)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "移動" }).click()

    const modal = page.getByRole("dialog", { name: new RegExp(`フォルダ「${src}」を移動`) })
    await modal.getByRole("button", { name: "選ぶ…" }).click()
    const picker = page.getByRole("dialog", { name: "移動先のフォルダを選ぶ" })
    await pickerExpandScopePath(picker)
    await picker.locator(".picker-row").filter({ hasText: dst }).first().click()
    await picker.getByRole("button", { name: "選択" }).click()
    await modal.getByRole("button", { name: "移動" }).click()

    await expect(getFolderRow(page, src)).toHaveCount(0, { timeout: 30_000 })
    await page.goto(`${scopeBrowseUrl()}${dst}/${src}/`)
    await expect(getRow(page, inside)).toBeVisible({ timeout: 15_000 })
  })

  test("S-FILEOPS-09: new folder (empty folder)", async ({ page }) => {
    const folder = uniqueFolder("fo09")
    await page.goto(scopeBrowseUrl())
    await page.locator(".pathbar .actions").getByRole("button", { name: "＋ 新規フォルダ" }).click()
    const modal = page.getByRole("dialog", { name: "新しいフォルダ" })
    await modal.getByLabel("フォルダ名").fill(folder)
    await modal.getByRole("button", { name: "作成" }).click()

    await expect(getFolderRow(page, folder)).toBeVisible({ timeout: 15_000 })
    await page.goto(`${scopeBrowseUrl()}${folder}/`)
    await expect(page.locator(".emptyzone")).toBeVisible({ timeout: 10_000 })
    // .keep は非表示
    await expect(page.locator(".row.sel").filter({ hasText: ".keep" })).toHaveCount(0)
  })

  test("S-FILEOPS-10: 公開中 file の rename → 旧 URL 404、新 URL 200", async ({ page, browser }) => {
    const src = uniqueName("fo10-src")
    const dst = uniqueName("fo10-dst")
    const content = "public-rename-carry-over"
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, src, content)
    await expectUploadRowAutoDismissed(page, src)

    // publish
    await getRow(page, src).locator(".pubbtn").click()
    const modal = page.getByRole("dialog", { name: "ファイルを公開" })
    await modal.getByRole("button", { name: "公開する" }).click()
    await expect(modal.locator(".flist .frow").locator(".tag.ok")).toHaveText("完了", { timeout: 15_000 })
    await modal.getByRole("button", { name: "閉じる" }).click()

    await expandRow(page, src)
    const oldUrl = await getPubPanel(page, src).locator(".linkbar .u").textContent()
    expect(oldUrl).not.toBeNull()

    // rename
    await openRowMenu(page, src)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "名前を変更" }).click()
    const renameModal = page.getByRole("dialog", { name: "名前を変更" })
    await renameModal.getByLabel("新しい名前").fill(dst)
    await renameModal.getByRole("button", { name: "変更" }).click()

    await expect(getRow(page, dst)).toBeVisible({ timeout: 20_000 })
    await expect(getRow(page, src)).toHaveCount(0)
    // tag carry-over
    await expect(getRow(page, dst).locator(".c-pub .tag.ok")).toHaveText("公開中", { timeout: 15_000 })

    // 新 URL は publicUrl(publicBase, bucket, dstKey) で計算 (SPA と同じ pattern)
    const bucket = e2eUsername()
    const publicBase = "http://localhost:28080"
    const dstKey = `${scopePrefix()}${dst}`
    const newUrl = publicUrlFor(publicBase, bucket, dstKey)

    // 旧 URL 404
    {
      const { context, response } = await getAnon(browser, oldUrl!)
      try {
        expect(response.status()).toBe(404)
      } finally {
        await context.close()
      }
    }
    // 新 URL 200 + byte 一致
    {
      const { context, response } = await getAnon(browser, newUrl)
      try {
        expect(response.status()).toBe(200)
        const body = await response.body()
        expect(body.toString()).toBe(content)
      } finally {
        await context.close()
      }
    }
  })

  test("E-FILEOPS-01: name 衝突 (rename)", async ({ page }) => {
    const a = uniqueName("efo01-a")
    const b = uniqueName("efo01-b")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, a, "a")
    await uploadTextFile(page, b, "b")
    await expectUploadRowAutoDismissed(page, b)

    await openRowMenu(page, a)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "名前を変更" }).click()
    const modal = page.getByRole("dialog", { name: "名前を変更" })
    await modal.getByLabel("新しい名前").fill(b)
    await modal.getByRole("button", { name: "変更" }).click()

    await expect(modal.locator(".ferr")).toHaveText(`「${b}」は既にあります`, { timeout: 5_000 })
    // modal は閉じていない
    await expect(modal).toBeVisible()
  })

  test("E-FILEOPS-02: 元の名前と同じで rename 拒否", async ({ page }) => {
    const name = uniqueName("efo02")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "x")
    await expectUploadRowAutoDismissed(page, name)

    await openRowMenu(page, name)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "名前を変更" }).click()
    const modal = page.getByRole("dialog", { name: "名前を変更" })
    await modal.getByRole("button", { name: "変更" }).click()

    await expect(modal.locator(".ferr")).toHaveText("元の名前と同じです")
  })

  test("E-FILEOPS-03: / を含む名前で rename / new folder", async ({ page }) => {
    // rename 側
    const name = uniqueName("efo03")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "x")
    await expectUploadRowAutoDismissed(page, name)

    await openRowMenu(page, name)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "名前を変更" }).click()
    const renameModal = page.getByRole("dialog", { name: "名前を変更" })
    await renameModal.getByLabel("新しい名前").fill("foo/bar.txt")
    await renameModal.getByRole("button", { name: "変更" }).click()
    await expect(renameModal.locator(".ferr")).toHaveText("名前に「/」は使えません")
    await renameModal.getByRole("button", { name: "キャンセル" }).click()

    // new folder 側
    await page.locator(".pathbar .actions").getByRole("button", { name: "＋ 新規フォルダ" }).click()
    const newFolderModal = page.getByRole("dialog", { name: "新しいフォルダ" })
    await newFolderModal.getByLabel("フォルダ名").fill("foo/bar")
    await newFolderModal.getByRole("button", { name: "作成" }).click()
    await expect(newFolderModal.locator(".ferr")).toHaveText("フォルダ名に「/」は使えません")
  })

  test("E-FILEOPS-04: folder move で自身の中への移動を拒否 (picker が src / descendant を disabled 表示)", async ({ page }) => {
    const parent = uniqueFolder("efo04-parent")
    const child = uniqueFolder("efo04-child")
    await createFolderViaSdk(page, `${scopePrefix()}${parent}/${child}`)
    await page.goto(scopeBrowseUrl())
    await expect(getFolderRow(page, parent)).toBeVisible({ timeout: 15_000 })

    await openFolderMenu(page, parent)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "移動" }).click()
    const modal = page.getByRole("dialog", { name: new RegExp(`フォルダ「${parent}」を移動`) })
    await modal.getByRole("button", { name: "選ぶ…" }).click()
    const picker = page.getByRole("dialog", { name: "移動先のフォルダを選ぶ" })
    await pickerExpandScopePath(picker)

    // src (parent-XXX) picker-row 自身と descendant (child-XXX) は
    // disabledPrefix で cursor: not-allowed / opacity: 0.4 になる。
    // 実装上、click しても setSelected されないので "自分自身の中には移動
    // できません" flash は現在の UI 経路では到達不能 (folder-move-modal.tsx
    // の defense-in-depth check として残す)。ここでは picker 側の disabled
    // 表現 (style 経由の opacity) を pin する。
    const srcRow = picker.locator(".picker-row").filter({ hasText: parent }).first()
    await expect(srcRow).toHaveCSS("opacity", "0.4")
    await expect(srcRow).toHaveCSS("cursor", "not-allowed")

    // src の caret を expand → child が見えるように
    await srcRow.locator('[aria-label="展開する"]').click()
    const childRow = picker.locator(".picker-row").filter({ hasText: child }).first()
    await expect(childRow).toBeVisible({ timeout: 10_000 })
    await expect(childRow).toHaveCSS("opacity", "0.4")
    await expect(childRow).toHaveCSS("cursor", "not-allowed")
  })

  test("E-FILEOPS-05: 空 name で submit → 拒否", async ({ page }) => {
    const name = uniqueName("efo05")
    await page.goto(scopeBrowseUrl())
    await uploadTextFile(page, name, "x")
    await expectUploadRowAutoDismissed(page, name)

    // rename 空
    await openRowMenu(page, name)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "名前を変更" }).click()
    const renameModal = page.getByRole("dialog", { name: "名前を変更" })
    await renameModal.getByLabel("新しい名前").fill("")
    await renameModal.getByRole("button", { name: "変更" }).click()
    await expect(renameModal.locator(".ferr")).toHaveText("名前を入力してください")
    await renameModal.getByRole("button", { name: "キャンセル" }).click()

    // new folder 空
    await page.locator(".pathbar .actions").getByRole("button", { name: "＋ 新規フォルダ" }).click()
    const newFolderModal = page.getByRole("dialog", { name: "新しいフォルダ" })
    await newFolderModal.getByRole("button", { name: "作成" }).click()
    await expect(newFolderModal.locator(".ferr")).toHaveText("フォルダ名を入力してください")
    await newFolderModal.getByRole("button", { name: "キャンセル" }).click()

    // copy 空
    await openRowMenu(page, name)
    await page.locator(".rowmenu").getByRole("menuitem", { name: "コピー" }).click()
    const copyModal = page.getByRole("dialog", { name: "コピー" })
    await copyModal.getByLabel("コピー後の名前").fill("")
    await copyModal.getByRole("button", { name: "コピー" }).click()
    await expect(copyModal.locator(".ferr")).toHaveText("名前を入力してください")
  })
})
