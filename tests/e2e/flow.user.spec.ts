// FLOW Domain (scenarios.md §FLOW): end-to-end smoke test で全 Domain の
// 重要 selector と経路 (login → upload → publish → 未認証 URL 200 → unpublish
// → 未認証 URL 404 → logout) を貫通する。個別 assertion は他 Domain に譲り、
// ここでは monolithic な happy path のみ pin する。
import { expect } from "@playwright/test"

import {
  clearClientPrefs,
  e2eUsername,
  expandRow,
  getAnon,
  getPubPanel,
  getRow,
  scopeBrowseUrl,
  uniqueName,
  uploadTextFile,
} from "./_helpers"
import { test } from "./fixtures"

test.describe("FLOW", () => {
  test.afterEach(async ({ page }) => {
    await clearClientPrefs(page).catch(() => undefined)
  })

  test("S-FLOW-01: upload → publish → 未認証で URL 200 → unpublish → 未認証で URL 404", async ({ browser, page }) => {
    const name = uniqueName("flow01")
    const content = "flow-smoke-body"

    await test.step("upload", async () => {
      await page.goto(scopeBrowseUrl())
      await uploadTextFile(page, name, content)
    })

    let url = ""
    await test.step("publish and capture URL", async () => {
      await getRow(page, name).locator(".pubbtn").click()
      const modal = page.getByRole("dialog", { name: "ファイルを公開" })
      await modal.getByRole("button", { name: "公開する" }).click()
      await expect(modal.locator(".flist .frow").locator(".tag.ok")).toHaveText("完了", { timeout: 15_000 })
      await modal.getByRole("button", { name: "閉じる" }).click()

      await expect(getRow(page, name).locator(".c-pub .tag.ok")).toHaveText("公開中", { timeout: 15_000 })
      await expandRow(page, name)
      url = (await getPubPanel(page, name).locator(".linkbar .u").textContent()) ?? ""
      expect(url).not.toBe("")
    })

    await test.step("fresh anon GET → 200", async () => {
      const { context, response } = await getAnon(browser, url)
      try {
        expect(response.status()).toBe(200)
        expect((await response.body()).toString()).toBe(content)
      } finally {
        await context.close()
      }
    })

    await test.step("unpublish", async () => {
      await getRow(page, name).locator(".pubbtn").click()
      await expect(getRow(page, name).locator(".c-pub .tag.ok")).toHaveCount(0, { timeout: 15_000 })
      await expect(getRow(page, name).locator(".pubbtn")).toHaveText("公開する")
    })

    await test.step("fresh anon GET → 404", async () => {
      const { context, response } = await getAnon(browser, url)
      try {
        expect(response.status()).toBe(404)
      } finally {
        await context.close()
      }
    })

    // logout は S-AUTH-05 で第 2 ユーザー経由で担保済み。主 test user の
    // SSO session を invalidate すると以降の spec が silent renew で失敗する
    // ため FLOW 側では明示的に logout は踏まない (scenarios v3 で明記)。
    void e2eUsername
  })
})
