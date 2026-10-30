import { http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import { presignShareUrl } from "~/lib/s3/presign"

import { stsAssumeRoleXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const ENDPOINT = "http://localhost:28333"

const stubSts = (expiration: string) => {
  server.use(
    http.post(`${ENDPOINT}/`, () =>
      HttpResponse.xml(stsAssumeRoleXml({
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret",
        sessionToken: "session-token",
        expiration,
      }))),
  )
}

const share = (overrides: Partial<Parameters<typeof presignShareUrl>[0]> = {}) =>
  presignShareUrl({
    endpoint: ENDPOINT,
    token: "jwt-token",
    bucket: "kura-tester",
    key: "docs/file v1.txt",
    method: "GET",
    expiresInSeconds: 900,
    ...overrides,
  })

describe("presignShareUrl", () => {
  test("presignShareUrl_get_signsUrlForEncodedKey", async () => {
    stubSts(new Date(Date.now() + 3600_000).toISOString())
    const { url } = await share()

    expect(url.startsWith(`${ENDPOINT}/kura-tester/docs/file%20v1.txt?`)).toBe(true)
    const params = new URL(url).searchParams
    expect(params.get("X-Amz-Expires")).toBe("900")
    expect(params.get("X-Amz-Security-Token")).toBe("session-token")
    expect(params.get("X-Amz-Credential")).toContain("AKIATEST")
    expect(params.get("X-Amz-Signature")).toBeTruthy()
  })

  test("presignShareUrl_methodChangesSignature", async () => {
    stubSts(new Date(Date.now() + 3600_000).toISOString())
    const get = await share({ method: "GET" })
    const put = await share({ method: "PUT" })

    expect(new URL(put.url).searchParams.get("X-Amz-Signature"))
      .not.toBe(new URL(get.url).searchParams.get("X-Amz-Signature"))
  })

  test("presignShareUrl_requestedShorterThanSession_expiresAtIsRequested", async () => {
    stubSts(new Date(Date.now() + 3600_000).toISOString())
    const { expiresAt } = await share({ expiresInSeconds: 900 })

    expect(Math.abs(expiresAt.getTime() - (Date.now() + 900_000))).toBeLessThan(5000)
  })

  test("presignShareUrl_sessionShorterThanRequested_expiresAtIsSessionExpiry", async () => {
    const sessionExpiry = new Date(Date.now() + 600_000)
    stubSts(sessionExpiry.toISOString())
    const { expiresAt } = await share({ expiresInSeconds: 3600 })

    expect(expiresAt).toEqual(sessionExpiry)
  })

  // The STS session is what the URL is signed with, so it has to last as long
  // as the URL; the access token's remaining life does not limit it.
  test.each([900, 3600, 43_200])("presignShareUrl_expires%i_requestsSessionOfSameLength", async (seconds) => {
    let body = new URLSearchParams()
    server.use(http.post(`${ENDPOINT}/`, async ({ request }) => {
      body = new URLSearchParams(await request.text())
      return HttpResponse.xml(stsAssumeRoleXml({
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret",
        sessionToken: "session-token",
        expiration: new Date(Date.now() + seconds * 1000).toISOString(),
      }))
    }))
    const { url } = await share({ expiresInSeconds: seconds })

    expect(body.get("DurationSeconds")).toBe(String(seconds))
    expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe(String(seconds))
  })

  test("presignShareUrl_stsRejection_propagates", async () => {
    server.use(http.post(`${ENDPOINT}/`, () => new HttpResponse(null, { status: 403 })))
    await expect(share()).rejects.toThrow()
  })
})
