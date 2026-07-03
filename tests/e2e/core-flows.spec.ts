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

  await row.getByRole("button", { name: "公開" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "公開する" }).click()
  await expect(page.getByRole("dialog").getByRole("button", { name: "公開停止" })).toBeVisible()
  const published = await page.request.get(publicUrl)
  expect(published.status()).toBe(200)
  expect(await published.text()).toBe(content)

  await page.getByRole("dialog").getByRole("button", { name: "公開停止" }).click()
  await expect(page.getByRole("dialog").getByRole("button", { name: "公開する" })).toBeVisible()
  const after = await page.request.get(publicUrl)
  expect(after.status()).toBe(404)

  await page.keyboard.press("Escape")
  await deleteFile(page, row)
})

test("filenames with spaces, percent, and unicode survive upload and public delivery", async ({ page }) => {
  await login(page)
  // requirements.md ファイル名の制約: kura 固有の制約は無い
  const name = `e2e 100% 実測 ${uniqueName("enc")}`
  const content = `encoded e2e ${name}`
  const row = await uploadTextFile(page, name, content)

  await row.getByRole("button", { name: "公開" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "公開する" }).click()
  await expect(page.getByRole("dialog").getByRole("button", { name: "公開停止" })).toBeVisible()
  const published = await page.request.get(`/${e2eUsername()}/${encodeURIComponent(name)}`)
  expect(published.status()).toBe(200)
  expect(await published.text()).toBe(content)

  await page.keyboard.press("Escape")
  await deleteFile(page, row)
})

test("a presigned GET serves the file to anyone holding the URL", async ({ page }) => {
  await login(page)
  const name = uniqueName("presign")
  const content = `presign e2e ${name}`
  const row = await uploadTextFile(page, name, content)

  await row.getByRole("button", { name: "共有" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "発行" }).click()
  const url = await page.getByLabel("presigned URL").inputValue()
  expect(url).toContain("X-Amz-Signature=")

  const res = await page.request.get(url)
  expect(res.status()).toBe(200)
  expect(await res.text()).toBe(content)

  await page.keyboard.press("Escape")
  await deleteFile(page, row)
})
