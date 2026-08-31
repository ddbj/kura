import { request as httpRequest } from "node:http"

import { describe, expect, inject, it } from "vitest"

type Response = {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

// node:http rather than fetch: the Host header is a forbidden header name for
// fetch, and the delivery server's host validation is one of the things under
// test here.
const get = (path: string, headers: Record<string, string> = {}): Promise<Response> => {
  const base = new URL(inject("spaBase"))

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: base.hostname,
        port: base.port,
        path,
        method: "GET",
        // Without these the socket is pooled and kept alive, which holds the
        // vitest worker open past the end of the run.
        agent: false,
        headers: { Connection: "close", ...headers },
      },
      (res) => {
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => { body += chunk })
        res.on("end", () => {
          req.destroy()
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body })
        })
      },
    )
    req.on("error", reject)
    req.end()
  })
}

// The delivery server serves the SPA build and nothing else. The build under
// test may be a placeholder (tests can run before a real build), so these
// assert the shape of the responses, never the page content.
describe("SPA delivery", () => {
  it("serves index.html at the root", async () => {
    const res = await get("/")
    expect(res.status).toBe(200)
    expect(String(res.headers["content-type"])).toContain("text/html")
  })

  it.each(["/browse/foo/bar/", "/auth/callback?code=x&state=y"])(
    "falls back to index.html for the SPA route %s",
    async (path) => {
      const res = await get(path)
      expect(res.status).toBe(200)
      expect(String(res.headers["content-type"])).toContain("text/html")
    },
  )

  // Everything else falls back to index.html, which is what makes deep links
  // work; build assets must not, or a browser holding a cached index.html
  // from before a redeploy gets HTML where it asked for JavaScript.
  it("404s a build asset that does not exist", async () => {
    const res = await get("/assets/does-not-exist-9f3c1a.js")
    expect(res.status).toBe(404)
    expect(String(res.headers["content-type"])).toContain("text/plain")
  })

  it.each([
    "/assets/../../package.json",
    "/assets/%2e%2e%2f%2e%2e%2fpackage.json",
  ])("does not serve %s from outside the build directory", async (path) => {
    const res = await get(path)
    expect(res.body).not.toContain("\"dependencies\"")
  })

  it("rejects a Host that is not in the allow list", async () => {
    const res = await get("/", { Host: "kura.example.invalid" })
    expect(res.status).toBe(403)
  })

  it("does not answer CORS: only SeaweedFS does", async () => {
    const res = await get("/", { Origin: "https://kura.example.invalid" })
    expect(res.headers["access-control-allow-origin"]).toBeUndefined()
  })
})
