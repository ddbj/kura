// Runs once per Playwright run (setup project). Drives the staging Keycloak
// login form and persists both cookie + localStorage (via storageState) AND a
// separate sessionStorage snapshot: react-oidc-context keeps the OIDC user in
// sessionStorage, which storageState does not capture (scenarios.md §3.2).
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { expect, test as setup } from "@playwright/test"

const STORAGE = "tests/e2e/.auth/user.storage.json"
const SESSION = "tests/e2e/.auth/user.session.json"

setup("authenticate", async ({ page }) => {
  const username = process.env["E2E_USERNAME"]
  const password = process.env["E2E_PASSWORD"]
  if (!username || !password) {
    throw new Error("auth.setup: E2E_USERNAME / E2E_PASSWORD must be set in .env")
  }

  mkdirSync(dirname(STORAGE), { recursive: true })

  await page.goto("/")
  await page.getByRole("button", { name: "DDBJ アカウントでログイン" }).click()

  await page.locator("#username, input[name=username]").waitFor({ state: "visible", timeout: 60_000 })
  await page.locator("#username, input[name=username]").fill(username)
  await page.locator("#password, input[name=password]").fill(password)
  await page.locator("#kc-login, button[name=login]").click()

  await expect(page.locator(".hdr .user")).toBeVisible({ timeout: 30_000 })

  await page.context().storageState({ path: STORAGE })

  // Canonical Storage iteration; JSON.stringify(sessionStorage) is unreliable
  // across Chromium versions (Storage lacks own-enumerable semantics).
  const snapshot = await page.evaluate(() => {
    const out: Record<string, string> = {}
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k === null) continue
      const v = sessionStorage.getItem(k)
      if (v === null) continue
      out[k] = v
    }

    return JSON.stringify(out)
  })
  writeFileSync(SESSION, snapshot)
})
