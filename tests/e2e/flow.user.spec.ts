// FLOW Domain (scenarios.md §FLOW): end-to-end smoke test で全 Domain の
// 重要 selector と経路 (login → upload → 期限つきリンク発行 → 未認証 GET で
// byte 一致 → logout) を貫通する。個別 assertion は他 Domain に譲り、ここでは
// monolithic な happy path のみ pin する。
import { expect } from "@playwright/test"

import {
  clearClientPrefs,
  e2eUsername,
  expandRow,
  getAnon,
  getPresignPanel,
  getRow,
  openPresignModalFromRow,
  scopeBrowseUrl,
  uniqueName,
  uploadTextFile,
} from "./_helpers"
import { test } from "./fixtures"

test.describe("FLOW", () => {
  test.afterEach(async ({ page }) => {
    await clearClientPrefs(page).catch(() => undefined)
  })

  test("S-FLOW-01: upload → 期限つきリンク発行 → 未認証で 200 + byte 一致", async ({ browser, page }) => {
    const name = uniqueName("flow01")
    const content = "flow-smoke-body"

    await test.step("upload", async () => {
      await page.goto(scopeBrowseUrl())
      await uploadTextFile(page, name, content)
    })

    let url = ""
    await test.step("issue a presigned URL and capture it", async () => {
      const modal = await openPresignModalFromRow(page, name)
      await modal.getByRole("button", { name: "リンクを発行" }).click()
      await expect(modal.locator(".flist .frow").locator(".tag.ok")).toHaveText("完了", { timeout: 15_000 })
      await modal.getByRole("button", { name: "閉じる" }).click()

      await expect(getRow(page, name).locator(".c-pub .tag.warn")).toHaveText("期限つき", { timeout: 15_000 })
      await expandRow(page, name)
      url = (await getPresignPanel(page, name).locator(".linkbar .u").textContent()) ?? ""
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

    // logout は S-AUTH-05 で第 2 ユーザー経由で担保済み。主 test user の
    // SSO session を invalidate すると以降の spec が silent renew で失敗する
    // ため FLOW 側では明示的に logout は踏まない。
    void e2eUsername
  })
})
