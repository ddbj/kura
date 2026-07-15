// CONFIG Domain (scenarios.md §CONFIG): nginx の非 SPA endpoint と SPA
// fallback の shape 検証。すべて page.request.get 経由 (実 UA routing は
// AUTH / BROWSE で追検)。
import { expect, test } from "@playwright/test"

import { e2eUsername } from "./_helpers"

test.describe("CONFIG", () => {
  test("S-CONFIG-01: /healthz が 200 ok\\n を返す", async ({ request }) => {
    const res = await request.get("/healthz")
    expect(res.status()).toBe(200)
    expect(await res.text()).toBe("ok\n")
  })

  test("S-CONFIG-02: /_config.json は SPA runtime 設定を JSON で返す", async ({ request }) => {
    const res = await request.get("/_config.json")
    expect(res.status()).toBe(200)
    expect(res.headers()["content-type"] ?? "").toContain("application/json")

    const body = (await res.json()) as Record<string, unknown>
    for (const key of ["oidcIssuer", "oidcClientId", "s3Endpoint", "publicBase", "fileTtlDays"]) {
      expect(typeof body[key], `${key} should be string`).toBe("string")
    }
    expect((body["oidcIssuer"] as string).length).toBeGreaterThan(0)
    expect((body["oidcClientId"] as string).length).toBeGreaterThan(0)

    const fileTtlDays = body["fileTtlDays"] as string
    expect(fileTtlDays === "" || /^[1-9][0-9]*$/.test(fileTtlDays)).toBe(true)
  })

  test("S-CONFIG-03: SPA route の URL 直打ちで index.html が 200 で返る", async ({ request }) => {
    for (const urlPath of ["/_browse/foo/bar/", "/_auth/callback?code=x&state=y"]) {
      const res = await request.get(urlPath)
      expect(res.status(), `status of ${urlPath}`).toBe(200)
      expect(res.headers()["cache-control"] ?? "").toContain("no-cache")
      expect(res.headers()["content-type"] ?? "").toContain("text/html")
      expect(await res.text()).toContain("<title>kura</title>")
    }
  })

  test("E-CONFIG-01: nginx location にマッチしない path は 404", async ({ request }) => {
    // path 部が空 (kura_path = "") → 正規表現の (?<kura_path>.+) にマッチしない
    const res1 = await request.get(`/${e2eUsername()}/`)
    expect(res1.status(), "GET /<user>/ should be 404").toBe(404)

    // username に "_" は許されない → 全体マッチ失敗 → nginx default 404
    const res2 = await request.get("/username_that_is_not_public/anything.txt")
    expect(res2.status(), "underscore-user path should be 404").toBe(404)
  })

  test("E-CONFIG-02: _ 始まりのパスは 404", async ({ request }) => {
    const res = await request.get("/_notaroute/anything.txt")
    expect(res.status()).toBe(404)
  })
})
