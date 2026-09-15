import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { AuthProvider, useAuth } from "react-oidc-context"
import { createRoutesStub } from "react-router"
import { beforeEach, describe, expect, test } from "vitest"

import { oidcProviderProps } from "~/lib/auth"
import type { AppConfig } from "~/lib/config"
import { ConfigProvider } from "~/lib/config"
import { LangProvider } from "~/lib/i18n"
import { createQueryClient } from "~/lib/query"
import { BrowsePage } from "~/routes/browse/browse-page"
import { OverlayProviders } from "~/shell"

import { seedAuthenticatedUser } from "../../_helpers/oidc"
import { testConfig } from "../../_helpers/render"
import { listMultipartUploadsXml, listObjectsV2Xml, s3ErrorXml, stsAssumeRoleXml } from "../../mocks/s3-xml"
import { server } from "../../mocks/server"

const ENDPOINT = testConfig.s3Endpoint
const USER = "kura-tester"

// Static metadata + disabled auto-renewal keep the AuthProvider off the
// network (discovery, silent-renew iframe), which jsdom cannot serve.
const testAuthProps = {
  ...oidcProviderProps(testConfig),
  automaticSilentRenew: false,
  metadata: {
    issuer: testConfig.oidcIssuer,
    authorization_endpoint: `${testConfig.oidcIssuer}/protocol/openid-connect/auth`,
    token_endpoint: `${testConfig.oidcIssuer}/protocol/openid-connect/token`,
    jwks_uri: `${testConfig.oidcIssuer}/protocol/openid-connect/certs`,
    end_session_endpoint: `${testConfig.oidcIssuer}/protocol/openid-connect/logout`,
  },
}

const AuthReady = () => {
  const auth = useAuth()

  return <span data-testid="auth-state">{auth.user ? "ready" : "pending"}</span>
}

const renderBrowse = async (config: AppConfig = testConfig) => {
  const Stub = createRoutesStub([{ path: "/", Component: () => <BrowsePage prefix="" /> }])
  render(
    <ConfigProvider value={config}>
      <AuthProvider {...testAuthProps}>
        <QueryClientProvider client={createQueryClient()}>
          <LangProvider initialLang="ja">
            <AuthReady />
            <OverlayProviders>
              <Stub initialEntries={["/"]} />
            </OverlayProviders>
          </LangProvider>
        </QueryClientProvider>
      </AuthProvider>
    </ConfigProvider>,
  )
  await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("ready"))
}

const sts = () =>
  http.post(ENDPOINT, () =>
    HttpResponse.xml(stsAssumeRoleXml({
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
      sessionToken: "session-token",
      expiration: new Date(Date.now() + 3600_000).toISOString(),
    })))

type ListedFile = { key: string; size: number; lastModified: string }

// The page fires three differently-shaped GETs at the same bucket URL: the
// directory listing (delimiter), the usage walk (no delimiter) and the pending
// multipart list (?uploads). They are told apart exactly as SeaweedFS would.
const seedBucket = ({
  files = [],
  dirs = [],
  usage = files,
  pages,
}: {
  files?: ListedFile[]
  dirs?: string[]
  usage?: ListedFile[]
  pages?: { files: ListedFile[]; dirs: string[] }[]
} = {}) => {
  const requestedTokens: (string | null)[] = []
  server.use(
    sts(),
    http.head(`${ENDPOINT}/${USER}`, () => new HttpResponse(null, { status: 200 })),
    http.get(`${ENDPOINT}/${USER}`, ({ request }) => {
      const url = new URL(request.url)
      if (url.searchParams.has("uploads")) {
        return HttpResponse.xml(listMultipartUploadsXml({ bucket: USER, uploads: [] }))
      }
      if (url.searchParams.get("delimiter") !== "/") {
        return HttpResponse.xml(listObjectsV2Xml({
          bucket: USER, prefix: "", objects: usage, commonPrefixes: [],
        }))
      }
      const token = url.searchParams.get("continuation-token")
      requestedTokens.push(token)
      if (pages !== undefined) {
        const index = token === null ? 0 : Number(token)
        const page = pages[index]
        if (page === undefined) throw new Error(`no page ${index}`)

        return HttpResponse.xml(listObjectsV2Xml({
          bucket: USER,
          prefix: "",
          objects: page.files,
          commonPrefixes: page.dirs,
          ...(index + 1 < pages.length ? { nextContinuationToken: String(index + 1) } : {}),
        }))
      }

      return HttpResponse.xml(listObjectsV2Xml({
        bucket: USER, prefix: "", objects: files, commonPrefixes: dirs,
      }))
    }),
  )

  return requestedTokens
}

const file = (key: string, size = 10): ListedFile =>
  ({ key, size, lastModified: "2026-07-01T10:00:00.000Z" })

beforeEach(() => {
  window.sessionStorage.clear()
  seedAuthenticatedUser(testConfig, { username: USER })
})

describe("BrowsePage listing", () => {
  test("browsePage_listing_showsFilesAndFolders", async () => {
    seedBucket({ files: [file("a.txt"), file("b.txt")], dirs: ["docs/"] })
    await renderBrowse()

    expect(await screen.findByText("a.txt")).toBeInTheDocument()
    expect(screen.getByText("b.txt")).toBeInTheDocument()
    expect(screen.getByText("docs")).toBeInTheDocument()
  })

  // A listing page caps out at 1000 entries. Rendering only the first page
  // would hide the rest of a large folder with no error anywhere.
  test("browsePage_truncatedListing_rendersEveryPage", async () => {
    const tokens = seedBucket({
      pages: [
        { files: [file("page1.txt")], dirs: ["first/"] },
        { files: [file("page2.txt")], dirs: ["second/"] },
      ],
      usage: [file("page1.txt"), file("page2.txt")],
    })
    await renderBrowse()

    expect(await screen.findByText("page1.txt")).toBeInTheDocument()
    expect(await screen.findByText("page2.txt")).toBeInTheDocument()
    expect(screen.getByText("first")).toBeInTheDocument()
    expect(screen.getByText("second")).toBeInTheDocument()
    expect(tokens).toEqual([null, "1"])
    // The lens count has to agree with the rows it claims to count.
    expect(screen.getByText("すべて").parentElement).toHaveTextContent("4")
  })

  // .keep only exists so an empty folder stays listable; it is not a file the
  // user put there.
  test("browsePage_keepMarker_isHiddenAndUncounted", async () => {
    seedBucket({ files: [file(".keep", 0), file("real.txt")] })
    await renderBrowse()

    expect(await screen.findByText("real.txt")).toBeInTheDocument()
    expect(screen.queryByText(".keep")).toBeNull()
    expect(screen.getByText("すべて").parentElement).toHaveTextContent("1")
  })
})

describe("BrowsePage quota", () => {
  const overQuotaConfig: AppConfig = { ...testConfig, quotaBytes: 100 }

  test("browsePage_overQuota_warnsAndBlocksUploads", async () => {
    seedBucket({ files: [file("big.bin", 500)] })
    await renderBrowse(overQuotaConfig)

    const alert = await screen.findByText(/容量が上限に達しています/)
    expect(alert).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /アップロード/ })).toBeDisabled()
  })

  test("browsePage_withinQuota_allowsUploads", async () => {
    seedBucket({ files: [file("small.txt", 10)] })
    await renderBrowse()

    expect(await screen.findByText("small.txt")).toBeInTheDocument()
    expect(screen.queryByText(/容量が上限に達しています/)).toBeNull()
    expect(screen.getByRole("button", { name: /アップロード/ })).toBeEnabled()
  })

  // The denominator is the deployment default baked into the bundle, not a
  // constant: a deployment with a different quota must show its own number.
  test("browsePage_quotaFromConfig_isTheMeterDenominator", async () => {
    seedBucket({ files: [file("small.txt", 10)] })
    await renderBrowse({ ...testConfig, quotaBytes: 2 * 1024 ** 3 })

    expect(await screen.findByText(/\/ 2 GB/)).toBeInTheDocument()
  })
})

describe("BrowsePage failures", () => {
  test("browsePage_bucketInitFails_offersARetryThatRecovers", async () => {
    // Flipped by the test rather than counted per request: the AWS SDK retries
    // a 500 internally, so a call counter would be spent before the user ever
    // sees the alert.
    let bucketReachable = false
    server.use(
      sts(),
      http.head(`${ENDPOINT}/${USER}`, () =>
        new HttpResponse(null, { status: bucketReachable ? 200 : 500 })),
      http.get(`${ENDPOINT}/${USER}`, ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.has("uploads")) {
          return HttpResponse.xml(listMultipartUploadsXml({ bucket: USER, uploads: [] }))
        }

        return HttpResponse.xml(listObjectsV2Xml({
          bucket: USER, prefix: "", objects: [file("after-retry.txt")], commonPrefixes: [],
        }))
      }),
    )
    await renderBrowse()

    const alert = await screen.findByRole("alert", {}, { timeout: 5000 })
    expect(alert).toHaveTextContent(/領域の初期化に失敗しました/)

    bucketReachable = true
    await userEvent.click(within(alert).getByRole("button", { name: "再試行" }))
    expect(await screen.findByText("after-retry.txt")).toBeInTheDocument()
  })

  test("browsePage_listingFails_reportsItAsAnAlert", async () => {
    server.use(
      sts(),
      http.head(`${ENDPOINT}/${USER}`, () => new HttpResponse(null, { status: 200 })),
      http.get(`${ENDPOINT}/${USER}`, ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.has("uploads")) {
          return HttpResponse.xml(listMultipartUploadsXml({ bucket: USER, uploads: [] }))
        }

        return new HttpResponse(s3ErrorXml("InternalError", "boom"), {
          status: 500, headers: { "Content-Type": "application/xml" },
        })
      }),
    )
    await renderBrowse()

    await waitFor(() =>
      expect(screen.getByText(/一覧の取得に失敗しました/)).toBeInTheDocument(), { timeout: 5000 })
  })
})

describe("BrowsePage unusable username", () => {
  // The username is the bucket name verbatim, so one that S3 rejects can never
  // get a space. Saying so beats a failing CreateBucket the user cannot act on.
  test("browsePage_usernameThatS3Rejects_explainsInsteadOfListing", async () => {
    window.sessionStorage.clear()
    seedAuthenticatedUser(testConfig, { username: "bad_name" })
    server.use(
      sts(),
      http.head(`${ENDPOINT}/bad_name`, () => {
        throw new Error("must not touch S3 for an unusable username")
      }),
    )
    await renderBrowse()

    expect(await screen.findByText(/このユーザー名では kura を利用できません/)).toBeInTheDocument()
  })
})
