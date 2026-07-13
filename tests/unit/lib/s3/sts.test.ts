import { http, HttpResponse } from "msw"
import { describe, expect, test } from "vitest"

import { assumeRoleWithToken } from "~/lib/s3/sts"

import { server } from "../../mocks/server"

const ENDPOINT = "http://localhost:28333"

// Wire format is XML — one field can be missing while the rest look intact.
// A silent undefined here would corrupt every subsequent signed request, so
// the client refuses the response outright.
const stsResponseXml = ({
  accessKeyId,
  secretAccessKey,
  sessionToken,
  expiration,
}: {
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  expiration?: string
}): string => `<?xml version="1.0" encoding="UTF-8"?>
<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <AssumeRoleWithWebIdentityResult>
    <Credentials>
      ${accessKeyId === undefined ? "" : `<AccessKeyId>${accessKeyId}</AccessKeyId>`}
      ${secretAccessKey === undefined ? "" : `<SecretAccessKey>${secretAccessKey}</SecretAccessKey>`}
      ${sessionToken === undefined ? "" : `<SessionToken>${sessionToken}</SessionToken>`}
      ${expiration === undefined ? "" : `<Expiration>${expiration}</Expiration>`}
    </Credentials>
  </AssumeRoleWithWebIdentityResult>
</AssumeRoleWithWebIdentityResponse>`

const stubSts = (xml: string) => {
  server.use(
    http.post(`${ENDPOINT}/`, () => HttpResponse.xml(xml)),
  )
}

const fullExpiration = new Date(Date.now() + 3600_000).toISOString()

describe("assumeRoleWithToken", () => {
  test("assumeRoleWithToken_completeResponse_returnsCredentials", async () => {
    stubSts(stsResponseXml({
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
      sessionToken: "session-token",
      expiration: fullExpiration,
    }))
    const creds = await assumeRoleWithToken(ENDPOINT, "jwt")
    expect(creds.accessKeyId).toBe("AKIATEST")
    expect(creds.secretAccessKey).toBe("secret")
    expect(creds.sessionToken).toBe("session-token")
    expect(creds.expiration).toEqual(new Date(fullExpiration))
  })

  test("assumeRoleWithToken_missingAccessKeyId_throws", async () => {
    stubSts(stsResponseXml({
      secretAccessKey: "secret",
      sessionToken: "session-token",
      expiration: fullExpiration,
    }))
    await expect(assumeRoleWithToken(ENDPOINT, "jwt")).rejects.toThrow(/incomplete/i)
  })

  test("assumeRoleWithToken_missingSecretAccessKey_throws", async () => {
    stubSts(stsResponseXml({
      accessKeyId: "AKIATEST",
      sessionToken: "session-token",
      expiration: fullExpiration,
    }))
    await expect(assumeRoleWithToken(ENDPOINT, "jwt")).rejects.toThrow(/incomplete/i)
  })

  test("assumeRoleWithToken_missingSessionToken_throws", async () => {
    stubSts(stsResponseXml({
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
      expiration: fullExpiration,
    }))
    await expect(assumeRoleWithToken(ENDPOINT, "jwt")).rejects.toThrow(/incomplete/i)
  })

  test("assumeRoleWithToken_missingExpiration_throws", async () => {
    stubSts(stsResponseXml({
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
      sessionToken: "session-token",
    }))
    await expect(assumeRoleWithToken(ENDPOINT, "jwt")).rejects.toThrow(/incomplete/i)
  })

  test("assumeRoleWithToken_roleSessionName_carriesLongRandomSuffix", async () => {
    // The RoleSessionName ends up in CloudTrail / access logs; a wider
    // random suffix reduces collision risk when many tabs assume the role
    // concurrently. 8 hex chars only gives ~4B combinations and gets ugly
    // quickly under load — 16 hex chars is comfortably out of that range.
    let body = ""
    server.use(http.post(`${ENDPOINT}/`, async ({ request }) => {
      body = await request.text()
      return HttpResponse.xml(stsResponseXml({
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret",
        sessionToken: "session-token",
        expiration: fullExpiration,
      }))
    }))
    await assumeRoleWithToken(ENDPOINT, "jwt")
    const decoded = decodeURIComponent(body)
    const match = decoded.match(/RoleSessionName=([^&]+)/)
    expect(match).not.toBeNull()
    const name = match![1] ?? ""
    expect(name.startsWith("kura-spa-")).toBe(true)
    const suffix = name.slice("kura-spa-".length)
    expect(suffix).toHaveLength(16)
    expect(suffix).toMatch(/^[0-9a-f]{16}$/)
  })

  test("assumeRoleWithToken_emptyAccessKeyId_throws", async () => {
    // An empty string bypasses the "undefined" check but is equally unusable
    // as a credential; the pre-flight refuses it.
    stubSts(stsResponseXml({
      accessKeyId: "",
      secretAccessKey: "secret",
      sessionToken: "session-token",
      expiration: fullExpiration,
    }))
    await expect(assumeRoleWithToken(ENDPOINT, "jwt")).rejects.toThrow(/incomplete/i)
  })
})
