/// <reference lib="dom" />
import { readFileSync } from "node:fs"

import { expect, test } from "@playwright/test"

import { deleteFile, e2eUsername, login, uniqueName, uploadTextFile } from "./_helpers"

// The four use cases (docs/requirements.md) through the real SPA, the dev
// compose stack, and the staging Keycloak. Run `docker compose --env-file
// env.dev --env-file .env up -d --wait` (after npm run build) first.

test("uploads, downloads, and deletes a file", async ({ page }) => {
  await login(page)
  const name = uniqueName("updown")
  const content = `hello kura e2e ${name}`
  const row = await uploadTextFile(page, name, content)

  const downloadPromise = page.waitForEvent("download")
  await row.getByRole("button", { name: "ダウンロード" }).click()
  const download = await downloadPromise
  const path = await download.path()
  expect(readFileSync(path, "utf8")).toBe(content)

  await deleteFile(page, row)
})

test("publishing gives the public URL a 200; unpublishing a 404", async ({ page }) => {
  await login(page)
  const name = uniqueName("public")
  const content = `public e2e ${name}`
  const row = await uploadTextFile(page, name, content)
  const publicUrl = `/${e2eUsername()}/${name}`

  const before = await page.request.get(publicUrl)
  expect(before.status()).toBe(404)

  const toggle = row.getByRole("switch")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-checked", "true")
  const published = await page.request.get(publicUrl)
  expect(published.status()).toBe(200)
  expect(await published.text()).toBe(content)

  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-checked", "false")
  const after = await page.request.get(publicUrl)
  expect(after.status()).toBe(404)

  await deleteFile(page, row)
})

test("filenames with spaces, percent, and unicode survive upload and public delivery", async ({ page }) => {
  await login(page)
  // requirements.md ファイル名の制約: kura 固有の制約は無い
  const name = `e2e 100% 実測 ${uniqueName("enc")}`
  const content = `encoded e2e ${name}`
  const row = await uploadTextFile(page, name, content)

  const toggle = row.getByRole("switch")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-checked", "true")
  const published = await page.request.get(`/${e2eUsername()}/${encodeURIComponent(name)}`)
  expect(published.status()).toBe(200)
  expect(await published.text()).toBe(content)

  await deleteFile(page, row)
})

test("dragging a file onto the page uploads it", async ({ page }) => {
  await login(page)
  const name = uniqueName("dragdrop")
  const content = `drag and drop e2e ${name}`

  const dataTransfer = await page.evaluateHandle(
    ({ name, content }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([content], name, { type: "text/plain" }))
      return dt
    },
    { name, content },
  )
  // Dispatch on a descendant of the drop area (breadcrumb text), not an
  // ancestor: native events bubble up, not down, into it.
  const dropTarget = page.getByText("ホーム")
  await dropTarget.dispatchEvent("dragenter", { dataTransfer })
  await expect(page.getByText("ここにドロップしてアップロード")).toBeVisible()
  await dropTarget.dispatchEvent("drop", { dataTransfer })

  await expect(page.getByText("アップロード完了")).toBeVisible({ timeout: 30_000 })
  const row = page.getByRole("listitem").filter({ hasText: name })
  await expect(row).toBeVisible()

  await deleteFile(page, row)
})

test("a presigned GET serves the file to anyone holding the URL", async ({ page }) => {
  await login(page)
  const name = uniqueName("presign")
  const content = `presign e2e ${name}`
  const row = await uploadTextFile(page, name, content)

  await row.getByRole("button", { name: "発行" }).click()
  const url = await row.getByLabel("presigned URL").inputValue()
  expect(url).toContain("X-Amz-Signature=")

  const res = await page.request.get(url)
  expect(res.status()).toBe(200)
  expect(await res.text()).toBe(content)

  await deleteFile(page, row)
})
