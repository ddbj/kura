import { randomBytes } from "node:crypto"

import type { Locator, Page } from "@playwright/test"
import { expect } from "@playwright/test"

export const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set (put the staging test user in .env)`)
  }

  return value
}

export const e2eUsername = (): string => requireEnv("E2E_USERNAME")

// Unique per test run so runs never share files and leftovers are traceable.
export const uniqueName = (label: string): string =>
  `e2e-${label}-${randomBytes(4).toString("hex")}.txt`

// Full OIDC round trip against the staging Keycloak login form.
export const login = async (page: Page): Promise<void> => {
  await page.goto("/?lang=ja")
  await page.getByRole("button", { name: "ログイン" }).click()
  await page.locator("#username").fill(e2eUsername())
  await page.locator("#password").fill(requireEnv("E2E_PASSWORD"))
  await page.locator("#kc-login").click()
  await expect(page.getByRole("button", { name: "アップロード", exact: true })).toBeVisible({ timeout: 30_000 })
}

export const uploadTextFile = async (page: Page, name: string, content: string): Promise<Locator> => {
  await page.locator("input[type=file]").first().setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  })
  await expect(page.getByText("アップロード完了")).toBeVisible({ timeout: 60_000 })
  const row = page.getByRole("row", { name: new RegExp(name) })
  await expect(row).toBeVisible()

  return row
}

export const deleteFile = async (page: Page, row: Locator): Promise<void> => {
  await row.getByRole("button", { name: "削除" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "削除" }).click()
  await expect(row).not.toBeVisible()
}
