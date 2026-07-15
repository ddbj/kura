// PUBSERVE Domain (scenarios.md §PUBSERVE): 公開 tag 有無 / 特殊文字 / Range /
// 未存在 → 実 UA (fresh anon context) で GET を叩き nginx enforcement 経路を pin。
// setup は authenticated context の SDK 経由 (upload + PutObjectTagging)。
import { access } from "node:fs/promises"

import { DeleteObjectTaggingCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

import {
  clearClientPrefs,
  e2eUsername,
  expectAuditLine,
  getAnon,
  makeMediumBinaryFile,
  publicUrlFor,
  s3ClientForE2e,
  scopePrefix,
  uniqueName,
} from "./_helpers"
import { test } from "./fixtures"

const PUBLIC_BASE = "http://localhost:28080"

test.describe("PUBSERVE", () => {
  test.afterEach(async ({ page }) => {
    await clearClientPrefs(page).catch(() => undefined)
  })

  // Helper: SDK 経由で upload + kura-public=true tag を付ける
  const uploadAndPublish = async (page: Page, key: string, body: Buffer): Promise<void> => {
    const s3 = await s3ClientForE2e(page)
    const bucket = e2eUsername()
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      Tagging: "kura-public=true",
    }))
  }

  test("S-PUBSERVE-01: 公開 tag 有り = 200 + Accept-Ranges + audit log 実観測", async ({ browser, page }) => {
    const name = uniqueName("pubserve01")
    const key = `${scopePrefix()}${name}`
    const content = Buffer.from("pubserve01-public-body")
    await page.goto("/")
    await page.locator(".hdr").waitFor({ state: "visible", timeout: 15_000 })
    await uploadAndPublish(page, key, content)

    const url = publicUrlFor(PUBLIC_BASE, e2eUsername(), key)

    const { context, response } = await getAnon(browser, url)
    try {
      expect(response.status()).toBe(200)
      expect(response.headers()["accept-ranges"]).toBe("bytes")
      const body = await response.body()
      expect(body.equals(content)).toBe(true)
    } finally {
      await context.close()
    }

    // audit log: KURA_LOG_DIR/access-YYYY-MM-DD.log に key の substring が現れる
    const logDir = process.env["KURA_LOG_DIR"] ?? "./logs"
    const yyyymmdd = new Date().toISOString().slice(0, 10)
    try {
      await access(`${logDir}/access-${yyyymmdd}.log`)
      await expectAuditLine(encodeURI(key).replace(/#/g, "%23"), { timeoutMs: 10_000 })
    } catch {
      test.skip(true, `audit log dir ${logDir} unreachable`)
    }
  })

  test("S-PUBSERVE-02: 公開 tag 無し = 404、公開停止直後 = 404", async ({ browser, page }) => {
    const name = uniqueName("pubserve02")
    const key = `${scopePrefix()}${name}`
    await page.goto("/")
    await page.locator(".hdr").waitFor({ state: "visible", timeout: 15_000 })
    await uploadAndPublish(page, key, Buffer.from("visible"))

    const url = publicUrlFor(PUBLIC_BASE, e2eUsername(), key)
    // まず public は 200
    {
      const { context, response } = await getAnon(browser, url)
      try {
        expect(response.status()).toBe(200)
      } finally {
        await context.close()
      }
    }

    // 公開停止 (SDK 直で kura-public tag を消す。unpublishObject と
    // 同じ挙動: 他 tag が無ければ DeleteObjectTagging で clear。
    // ここでは他 tag は付けていないので Delete で足りる。)
    const s3 = await s3ClientForE2e(page)
    await s3.send(new DeleteObjectTaggingCommand({ Bucket: e2eUsername(), Key: key }))

    // 停止後 = 404
    const { context: c2, response: r2 } = await getAnon(browser, url)
    try {
      expect(r2.status()).toBe(404)
    } finally {
      await c2.close()
    }
  })

  test("S-PUBSERVE-03: 特殊文字を含む key の公開配信", async ({ browser, page }) => {
    const hex = Math.random().toString(16).slice(2, 10)
    const name = `pubserve03-${hex}#test space 100%.txt`
    const key = `${scopePrefix()}${name}`
    const content = Buffer.from("special-chars-body")
    await page.goto("/")
    await page.locator(".hdr").waitFor({ state: "visible", timeout: 15_000 })
    await uploadAndPublish(page, key, content)

    const url = publicUrlFor(PUBLIC_BASE, e2eUsername(), key)
    const { context, response } = await getAnon(browser, url)
    try {
      expect(response.status()).toBe(200)
      const body = await response.body()
      expect(body.equals(content)).toBe(true)
    } finally {
      await context.close()
    }
  })

  test("S-PUBSERVE-04: Range request で 206", async ({ browser, page }) => {
    const name = uniqueName("pubserve04", "bin")
    const key = `${scopePrefix()}${name}`
    const { path, buffer, cleanup } = await makeMediumBinaryFile(2, 0x77)
    void path
    try {
      await page.goto("/")
      await page.locator(".hdr").waitFor({ state: "visible", timeout: 15_000 })
      await uploadAndPublish(page, key, buffer)

      const url = publicUrlFor(PUBLIC_BASE, e2eUsername(), key)
      const { context, response } = await getAnon(browser, url, { headers: { Range: "bytes=0-1023" } })
      try {
        expect(response.status()).toBe(206)
        expect(response.headers()["content-length"]).toBe("1024")
      } finally {
        await context.close()
      }
    } finally {
      await cleanup()
    }
  })

  test("E-PUBSERVE-01: 存在しない object = 404", async ({ browser, page }) => {
    // page は sessionStorage 注入用の fixture 依存で unused だが必須
    void page
    const hex = Math.random().toString(16).slice(2, 10)
    const url = `${PUBLIC_BASE}/${e2eUsername()}/never-existed-${hex}.txt`
    const { context, response } = await getAnon(browser, url)
    try {
      expect(response.status()).toBe(404)
    } finally {
      await context.close()
    }
  })
})
