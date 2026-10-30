import { describe, expect, test } from "vitest"

import { crawlFiles, isHttpOrigin, llmsText, parseNoindex, robotsText, sitemapXml } from "~/lib/crawl"

const input = {
  uiOrigin: "https://kura.example.org",
  noindex: false,
  s3Endpoint: "https://kura-s3.example.org",
  oidcIssuer: "https://idp.example.org/realms/master",
  oidcClientId: "kura",
}

describe("robotsText", () => {
  test("indexed_allowsTopPage_closesBrowseAndAuth_pointsAtSitemap", () => {
    expect(robotsText(input)).toBe(
      "User-agent: *\nDisallow: /browse\nDisallow: /auth/\n\nSitemap: https://kura.example.org/sitemap.xml\n",
    )
  })

  test("noindex_closesEverythingButLlmsTxt_withoutSitemap", () => {
    expect(robotsText({ ...input, noindex: true })).toBe("User-agent: *\nAllow: /llms.txt\nDisallow: /\n")
  })
})

describe("sitemapXml", () => {
  test("listsOnlyTheTopPage", () => {
    const xml = sitemapXml(input.uiOrigin)
    expect([...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])).toEqual(["https://kura.example.org/"])
    expect(xml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")).toBe(true)
  })

  // An origin may carry `&` in its host; the sitemap must stay well-formed XML.
  test("origin_withXmlSpecialCharacter_isEscaped", () => {
    expect(sitemapXml("https://a&b.example")).toContain("<loc>https://a&amp;b.example/</loc>")
  })
})

describe("llmsText", () => {
  test("opensWithTitleAndSummary_asLlmsTxtIsRead", () => {
    const [title, blank, summary] = llmsText(input).split("\n")
    expect(title).toBe("# kura")
    expect(blank).toBe("")
    expect(summary?.startsWith("> ")).toBe(true)
  })

  test("namesTheDeploymentsOwnEndpointsAndClient", () => {
    const text = llmsText(input)
    expect(text).toContain("https://kura-s3.example.org")
    expect(text).toContain("https://idp.example.org/realms/master")
    expect(text).toContain("client `kura`")
    expect(text).toContain("https://kura.example.org")
    expect(text).toContain("https://github.com/ddbj/kura/blob/main/docs/sp-integration.md")
  })
})

describe("crawlFiles", () => {
  test("indexed_writesAllThree", () => {
    expect(Object.keys(crawlFiles(input)).sort()).toEqual(["llms.txt", "robots.txt", "sitemap.xml"])
  })

  test("noindex_writesNoSitemap", () => {
    expect(Object.keys(crawlFiles({ ...input, noindex: true })).sort()).toEqual(["llms.txt", "robots.txt"])
  })
})

describe("parseNoindex", () => {
  test.each([
    [undefined, false],
    ["", false],
    ["true", true],
  ])("value_%j_is_%s", (value, expected) => {
    expect(parseNoindex(value)).toBe(expected)
  })

  // A typo must not silently publish a deployment meant to stay out.
  test.each(["false", "TRUE", "1", "yes", " true", "true "])("value_%j_isRejected", (value) => {
    expect(() => parseNoindex(value)).toThrow(/KURA_NOINDEX/)
  })
})

describe("isHttpOrigin", () => {
  test.each([
    "https://kura.example.org",
    "http://localhost:28080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
  ])("%s_isAccepted", (value) => {
    expect(isHttpOrigin(value)).toBe(true)
  })

  test.each([
    "",
    "kura.example.org",
    "https://kura.example.org/",
    "https://kura.example.org/path",
    "https://kura.example.org?q=1",
    "https://kura.example.org#top",
    "https://Kura.example.org",
    "https://kura.example.org:443",
    "https://user@kura.example.org",
    "ftp://kura.example.org",
    "https://kura.example.org\n",
  ])("%j_isRejected", (value) => {
    expect(isHttpOrigin(value)).toBe(false)
  })
})
