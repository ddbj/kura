import { http, HttpResponse } from "msw"
import { describe, expect, test, vi } from "vitest"

import { createStsCredentialsProvider } from "~/lib/s3/credentials"

import { s3ErrorXml, stsAssumeRoleXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const ENDPOINT = "http://localhost:28333"

const stubSts = (expiration: string) => {
  const seen: { body: string | null }[] = []
  server.use(
    http.post(`${ENDPOINT}/`, async ({ request }) => {
      seen.push({ body: await request.text() })
      return HttpResponse.xml(stsAssumeRoleXml({
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret",
        sessionToken: "session-token",
        expiration,
      }))
    }),
  )
  return seen
}

describe("createStsCredentialsProvider", () => {
  test("provider_resolvesCredentialsWithExpiration", async () => {
    const expiration = new Date(Date.now() + 3600_000).toISOString()
    const seen = stubSts(expiration)
    const getToken = vi.fn().mockResolvedValue("jwt-token")

    const provider = createStsCredentialsProvider(getToken, ENDPOINT)
    const creds = await provider()

    expect(creds.accessKeyId).toBe("AKIATEST")
    expect(creds.secretAccessKey).toBe("secret")
    expect(creds.sessionToken).toBe("session-token")
    expect(creds.expiration).toEqual(new Date(expiration))
    expect(getToken).toHaveBeenCalledTimes(1)
    expect(seen[0]?.body).toContain("Action=AssumeRoleWithWebIdentity")
    expect(seen[0]?.body).toContain("WebIdentityToken=jwt-token")
    expect(seen[0]?.body).toContain(encodeURIComponent("arn:aws:iam::role/KuraUserRole"))
  })

  test("provider_freshTokenPerInvocation", async () => {
    stubSts(new Date(Date.now() + 3600_000).toISOString())
    const getToken = vi.fn().mockResolvedValue("jwt-token")
    const provider = createStsCredentialsProvider(getToken, ENDPOINT)

    await provider()
    await provider()
    expect(getToken).toHaveBeenCalledTimes(2)
  })

  test("provider_stsRejection_propagates", async () => {
    server.use(
      http.post(`${ENDPOINT}/`, () =>
        new HttpResponse(s3ErrorXml("AccessDenied", "token expired"), {
          status: 403,
          headers: { "Content-Type": "application/xml" },
        })),
    )
    const provider = createStsCredentialsProvider(() => Promise.resolve("expired"), ENDPOINT)
    await expect(provider()).rejects.toThrow()
  })

  test("provider_getTokenFailure_propagates", async () => {
    const provider = createStsCredentialsProvider(() => Promise.reject(new Error("renew failed")), ENDPOINT)
    await expect(provider()).rejects.toThrow("renew failed")
  })
})
