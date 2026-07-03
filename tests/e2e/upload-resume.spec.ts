import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

import { deleteFile, login, uniqueName } from "./_helpers"

// Interrupt a multipart upload by going offline, then finish it through the
// toast's resume action (requirements.md upload: レジューム).
test("an upload interrupted offline resumes to a byte-identical file", async ({ page }) => {
  await login(page)
  const name = uniqueName("resume").replace(".txt", ".bin")
  // Multiple 8 MiB parts so the multipart path (the resumable one) is taken
  // and the transfer is still in flight when the network drops.
  const bytes = Buffer.alloc(64 * 1024 * 1024)
  for (let i = 0; i < bytes.length; i += 4096) bytes[i] = i % 251
  // Playwright caps in-memory payloads at 50 MB, so stage the file on disk.
  const sourcePath = join(tmpdir(), name)
  writeFileSync(sourcePath, bytes)

  // Cut the network right after CreateMultipartUpload succeeds: the upload
  // then fails mid-part with an uploadId to resume from.
  const created = page.waitForResponse((response) => response.url().includes("?uploads"))
  await page.locator("input[type=file]").first().setInputFiles(sourcePath)
  await created
  await page.context().setOffline(true)
  const resumeButton = page.getByRole("button", { name: "再開" })
  await expect(resumeButton).toBeVisible({ timeout: 120_000 })

  await page.context().setOffline(false)
  await resumeButton.click()
  await expect(page.getByText("アップロード完了")).toBeVisible({ timeout: 120_000 })

  const row = page.getByRole("row", { name: new RegExp(name) })
  await expect(row).toBeVisible()
  const downloadPromise = page.waitForEvent("download")
  await row.getByRole("button", { name: "ダウンロード" }).click()
  const download = await downloadPromise
  const path = await download.path()
  expect(readFileSync(path).equals(bytes)).toBe(true)

  await deleteFile(page, row)
})
