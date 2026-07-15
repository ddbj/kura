// SHELL Domain (scenarios.md §SHELL): Header wordmark / UserMenu 開閉 /
// LangSwitch とその i18n 効果範囲。
import { expect } from "@playwright/test"

import { clearClientPrefs, createFolderViaSdk, e2eUsername, uniqueFolder } from "./_helpers"
import { test } from "./fixtures"

test.describe("SHELL", () => {
  test.afterEach(async ({ page }) => {
    await clearClientPrefs(page).catch(() => undefined)
  })

  test("S-SHELL-01: Header wordmark で / に戻る", async ({ page }) => {
    const folder = uniqueFolder("shell01")
    await page.goto("/")
    await createFolderViaSdk(page, folder)
    await page.goto(`/_browse/${folder}/`)
    await expect(page.locator(".pathbar .crumb .cur")).toHaveText(folder)

    await page.locator(".hdr").getByRole("link", { name: "kura" }).click()
    await expect(page).toHaveURL(new RegExp(`${new URL(page.url()).origin}/$`))
    await expect(page.locator(".pathbar .crumb .cur")).toHaveText(e2eUsername())
  })

  test("S-SHELL-02: UserMenu 開閉と outside-click", async ({ page }) => {
    await page.goto("/")
    const trigger = page.locator(".hdr .user")
    await expect(trigger).toBeVisible()

    await trigger.click()
    await expect(page.locator(".usermenu")).toBeVisible()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")

    // 外側 (.wrap の空きスペース) をクリック → menu 閉じる
    await page.locator(".wrap").click({ position: { x: 5, y: 5 } })
    await expect(page.locator(".usermenu")).toHaveCount(0)
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
  })

  test("S-SHELL-03: UserMenu を Escape で閉じ、focus が trigger に戻る", async ({ page }) => {
    await page.goto("/")
    const trigger = page.locator(".hdr .user")
    await trigger.click()
    await expect(page.locator(".usermenu")).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(page.locator(".usermenu")).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test("S-SHELL-04: LangSwitch で EN に切替 → i18n 効果範囲が明確", async ({ page }) => {
    await page.goto("/")

    // 初期は JA (project の locale: ja-JP + 未設定の localStorage)
    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    await page.locator(".lang").getByRole("button", { name: "EN" }).click()
    await expect(page.locator("html")).toHaveAttribute("lang", "en")

    const trigger = page.locator(".hdr .user")
    await trigger.click()
    await expect(page.locator(".usermenu").getByRole("menuitem", { name: "Log out" })).toBeVisible()

    // localStorage 永続化
    const stored = await page.evaluate(() => localStorage.getItem("kura.lang"))
    expect(stored).toBe("en")

    // 効果範囲外: browse ページの「＋ 新規フォルダ」/「アップロード」は literal ja
    await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: "＋ 新規フォルダ" })).toBeVisible()
    await expect(page.getByRole("button", { name: /アップロード/ })).toBeVisible()
    // negative: Upload という英語文言は無い
    await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0)
  })

  test("S-SHELL-05: ?lang=en 直打ちで one-shot 上書き", async ({ page }) => {
    await page.goto("/?lang=en")
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    // URL query が stripped
    await expect(page).toHaveURL(/\/$/)
    expect(new URL(page.url()).searchParams.get("lang")).toBeNull()
  })
})
