import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { isHttpOrigin, robotsText, sitemapXml } from "~/lib/crawl"

const httpOrigin = fc.webUrl({ validSchemes: ["http", "https"] }).map((url) => new URL(url).origin)

describe("crawl properties", () => {
  test.prop([httpOrigin])("origin_asTheBrowserWritesIt_isAccepted", (origin) => {
    expect(isHttpOrigin(origin)).toBe(true)
  })

  // robots.txt and sitemap.xml append paths, so a trailing part would double
  // the slash or point somewhere else.
  test.prop([httpOrigin, fc.constantFrom("/", "/x", "?a=1", "#f")])("origin_withAnythingAfterIt_isRejected", (origin, tail) => {
    expect(isHttpOrigin(`${origin}${tail}`)).toBe(false)
  })

  test.prop([httpOrigin])("indexedRobots_sitemapLine_isTheOriginsSitemap", (origin) => {
    const sitemapLine = robotsText({ uiOrigin: origin, noindex: false }).split("\n").find((line) => line.startsWith("Sitemap: "))
    expect(sitemapLine).toBe(`Sitemap: ${origin}/sitemap.xml`)
  })

  // The XML stays well-formed for any accepted origin: no raw `&` or `<`
  // survives into the <loc>.
  test.prop([httpOrigin])("sitemap_loc_hasNoUnescapedMarkup", (origin) => {
    const loc = /<loc>([^<]*)<\/loc>/.exec(sitemapXml(origin))?.[1]
    expect(loc).toBeDefined()
    expect(loc).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/)
  })
})
