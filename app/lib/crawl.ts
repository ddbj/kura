// What the deployment tells search engines and programs: robots.txt,
// sitemap.xml and llms.txt. vite.config.ts writes them next to the bundle at
// build time, from the same embedded values as the SPA, and
// scripts/serve-spa.ts keeps their names out of the SPA fallback.
//
// Only the top page is for search engines: /browse lists a signed-in user's
// own files and /auth/ is the middle of a sign-in. A deployment kept out of
// search engines turns every crawler away and has no sitemap, but leaves
// /llms.txt open, since a program that honours robots.txt would otherwise be
// turned away from the one file written for it.
//
// No imports: the runtime image copies this file alone for serve-spa.ts.

export const CRAWL_FILES = ["robots.txt", "sitemap.xml", "llms.txt"] as const

export type CrawlFile = (typeof CRAWL_FILES)[number]

export type CrawlInput = {
  // The UI's public origin, without a trailing slash.
  uiOrigin: string
  noindex: boolean
  s3Endpoint: string
  oidcIssuer: string
  oidcClientId: string
}

const SP_GUIDE_URL = "https://github.com/ddbj/kura/blob/main/docs/sp-integration.md"

// KURA_NOINDEX: "true" keeps the deployment out of search engines, empty (or
// unset) lets the top page in. Anything else is a typo that would silently
// publish a deployment meant to stay out, so it is rejected.
export const parseNoindex = (value: string | undefined): boolean => {
  if (value === undefined || value === "") return false
  if (value === "true") return true
  throw new Error(`KURA_NOINDEX must be "true" or empty, got ${JSON.stringify(value)}`)
}

// An http(s) origin as the browser writes it: no path, query, fragment or
// trailing slash. robots.txt and sitemap.xml append paths to it.
export const isHttpOrigin = (value: string): boolean => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value
}

const escapeXml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;")

export const robotsText = (input: { uiOrigin: string; noindex: boolean }): string =>
  input.noindex
    ? "User-agent: *\nAllow: /llms.txt\nDisallow: /\n"
    : `User-agent: *\nDisallow: /browse\nDisallow: /auth/\n\nSitemap: ${input.uiOrigin}/sitemap.xml\n`

export const sitemapXml = (uiOrigin: string): string =>
  [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">",
    "  <url>",
    `    <loc>${escapeXml(`${uiOrigin}/`)}</loc>`,
    "  </url>",
    "</urlset>",
    "",
  ].join("\n")

// Sends a program to the S3 API rather than the web UI: the UI is one client
// of that API, and everything it does the API does too.
export const llmsText = (input: CrawlInput): string =>
  [
    "# kura",
    "",
    "> kura is a storage service of DDBJ. A user who signs in with a DDBJ account gets a private area (an S3 bucket) for large files, up to the 100 GB class. The user reads and writes the files from a browser, from a command line, or through a service that the user delegates access to.",
    "",
    "Programs should use the S3 API, not the web UI. The web UI is a client of the same S3 API, and every operation in the UI is also available through the API.",
    "",
    "## Endpoints",
    "",
    `- S3 API and STS: ${input.s3Endpoint} (region: us-east-1)`,
    `- OIDC issuer (DDBJ account): ${input.oidcIssuer}`,
    `- OIDC client ID: ${input.oidcClientId}`,
    `- Web UI: ${input.uiOrigin}`,
    "",
    "## Access from a program",
    "",
    `1. Get an access token for the client \`${input.oidcClientId}\` from the OIDC issuer. A program without a browser uses the device authorization grant (RFC 8628) with PKCE (S256).`,
    "2. Call `AssumeRoleWithWebIdentity` on the STS endpoint with the access token. The response contains temporary S3 credentials.",
    "3. Sign S3 requests with the temporary credentials (SigV4). The bucket name is the username of the DDBJ account (the `preferred_username` claim of the access token). A user can access only their own bucket.",
    "",
    "## Documentation",
    "",
    `- [Guide for services and command-line use](${SP_GUIDE_URL}): the full procedure with aws cli, the Keycloak client settings for a service, limits, and errors (in Japanese)`,
    "",
  ].join("\n")

export const crawlFiles = (input: CrawlInput): Partial<Record<CrawlFile, string>> => ({
  "robots.txt": robotsText(input),
  ...input.noindex ? {} : { "sitemap.xml": sitemapXml(input.uiOrigin) },
  "llms.txt": llmsText(input),
})
