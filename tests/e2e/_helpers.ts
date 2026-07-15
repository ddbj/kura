// Shared E2E helpers (scenarios.md §5.1). Every helper is per-test scoped so
// specs stay independent. Do not stash state on module scope beyond the
// once-per-run values read from process.env at load time.
import { randomBytes } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  AbortMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { AssumeRoleWithWebIdentityCommand, STSClient } from "@aws-sdk/client-sts"
import type { APIResponse, Browser, BrowserContext, Locator, Page, Route } from "@playwright/test"
import { expect } from "@playwright/test"

import { keyToUrlPath } from "~/lib/s3/keys"
import { SEAWEEDFS_S3_CLIENT_OPTIONS } from "~/lib/s3/seaweedfs-compat"

// ---------------------------------------------------------------------------
// env / naming

export const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set (put the staging test user in .env)`)
  }

  return value
}

export const e2eUsername = (): string => requireEnv("E2E_USERNAME")
export const e2ePassword = (): string => requireEnv("E2E_PASSWORD")
export const runId = (): string => requireEnv("KURA_E2E_RUN_ID")
export const s3Endpoint = (): string =>
  process.env["KURA_E2E_S3_ENDPOINT"] ?? "http://localhost:28333"
export const baseUrl = (): string =>
  process.env["KURA_E2E_BASE_URL"] ?? "http://localhost:28080"

const hex8 = (): string => randomBytes(8).toString("hex")

// A key that upload flows can pass as the leaf name for setInputFiles.
// Chromium strips any "/" so we never embed a path here; the enclosing prefix
// is controlled by first navigating to /_browse/e2e/${runId}/.
export const uniqueName = (label: string, ext = "txt"): string =>
  `e2e-${label}-${hex8()}.${ext}`

export const uniquePrefix = (label: string): string => `e2e-${label}-${hex8()}/`

// A folder name string (no separators) suitable for NewFolderModal input.
export const uniqueFolder = (label: string): string => `e2e-${label}-${hex8()}`

// Key prefix that every test bucket scopes its data under.
export const scopePrefix = (): string => `e2e/${runId()}/`

// URL path that a Playwright test navigates to before starting an upload.
export const scopeBrowseUrl = (): string => `/_browse/e2e/${runId()}/`

// ---------------------------------------------------------------------------
// selectors

export const getRow = (page: Page, filename: string): Locator =>
  page.locator(".row.sel").filter({ hasText: filename }).filter({ hasNot: page.locator(".nm.folder") })

export const getFolderRow = (page: Page, folder: string): Locator =>
  page.locator(".row.sel").filter({ hasText: folder }).filter({ has: page.locator(".nm.folder") })

// A `.card`-scoped bulk bar (avoids the collision with pending-uploads card
// header which also uses className "bulkbar", scenarios.md §4 note).
export const getBulkBar = (page: Page): Locator =>
  page.locator('.card:not(:has([data-testid="pending-uploads"])) .bulkbar')

export const openRowMenu = async (page: Page, filename: string): Promise<Locator> => {
  await page.getByRole("button", { name: `${filename} の操作` }).click()
  const menu = page.locator(".rowmenu")
  await menu.waitFor({ state: "visible" })

  return menu
}

export const openFolderMenu = async (page: Page, folder: string): Promise<Locator> => {
  await page.getByRole("button", { name: `${folder} の操作` }).click()
  const menu = page.locator(".rowmenu")
  await menu.waitFor({ state: "visible" })

  return menu
}

export const openUploadMenu = async (page: Page): Promise<Locator> => {
  await page.locator(".pathbar .actions").getByRole("button", { name: /アップロード/ }).click()
  const menu = page.locator(".uploadmenu")
  await menu.waitFor({ state: "visible" })

  return menu
}

// Non-interactive click that toggles pubpanel / presignpanel expansion. The
// `.c-size` cell is a `<div>` (non-interactive) so onRowActivate fires.
export const expandRow = async (page: Page, filename: string): Promise<void> => {
  const row = getRow(page, filename)
  await row.locator(".c-size").click()
  await expect(row).toHaveAttribute("aria-expanded", "true")
}

// `.pubpanel` / `.presignpanel` are siblings of `.row.sel` (both children of
// the row's wrapper `<div key={key}>`). `getRow(...).locator(".pubpanel")`
// wouldn't reach them, so travel up one level via xpath.
export const getPubPanel = (page: Page, filename: string): Locator =>
  getRow(page, filename).locator("xpath=..").locator(".pubpanel")

export const getPresignPanel = (page: Page, filename: string): Locator =>
  getRow(page, filename).locator("xpath=..").locator(".presignpanel")

// FolderPicker (MoveModal / FolderMoveModal から開かれる) は初期状態で bucket
// root だけ expand されており、subfolder は caret を順に click しないと見え
// ない。runId scope 内の folder を選択したいときは `e2e/` と `${runId}` を
// 事前 expand する必要がある。scope を跨がない前提。
//
// 各 expand の後、target 名を持つ次階層の picker-row が visible になるまで
// 待つ (FolderChildren は開いた瞬間に React Query fetch が走るため子は
// 非同期に visible 化する)。
export const pickerExpandScopePath = async (picker: Locator): Promise<void> => {
  const runIdValue = requireEnv("KURA_E2E_RUN_ID")

  const expandAndWaitChild = async (parentName: string, childName: string): Promise<void> => {
    const parentRow = picker.locator(".picker-row").filter({ hasText: parentName }).first()
    await parentRow.waitFor({ state: "visible", timeout: 10_000 })
    const caret = parentRow.locator('[aria-label="展開する"]')
    if ((await caret.count()) > 0) await caret.click()
    // child が visible になるまで待つ (FolderChildren の初回 fetch を吸収)
    await picker.locator(".picker-row").filter({ hasText: childName }).first()
      .waitFor({ state: "visible", timeout: 10_000 })
  }

  await expandAndWaitChild("e2e", runIdValue)
  // runId の caret を expand し、子 (何でも良い) が見えるまで待つ。
  const runIdRow = picker.locator(".picker-row").filter({ hasText: runIdValue }).first()
  const runIdCaret = runIdRow.locator('[aria-label="展開する"]')
  if ((await runIdCaret.count()) > 0) await runIdCaret.click()
}

// ---------------------------------------------------------------------------
// upload input pickers (HiddenFileInput scope splitting; see frontend.md §7)

export const pickFileMenuInput = (page: Page): Locator =>
  page.locator(".pathbar .actions input[type=file]:not([webkitdirectory])")

export const pickFolderMenuInput = (page: Page): Locator =>
  page.locator(".pathbar .actions input[type=file][webkitdirectory]")

export const pickPendingResumeInput = (page: Page): Locator =>
  page.locator("[data-testid=\"pending-uploads\"] input[type=file]")

export const pickEmptyStateInput = pickFileMenuInput

// ---------------------------------------------------------------------------
// upload flow helpers

export const uploadTextFile = async (page: Page, name: string, content: string): Promise<Locator> => {
  await openUploadMenu(page)
  await page.locator(".uploadmenu").getByRole("menuitem", { name: "ファイルを選択" }).click()
  await pickFileMenuInput(page).setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  })
  await expectUploadDone(page, name)

  return getRow(page, name)
}

export const uploadFileFromPath = async (page: Page, sourcePath: string, name?: string): Promise<void> => {
  await openUploadMenu(page)
  await page.locator(".uploadmenu").getByRole("menuitem", { name: "ファイルを選択" }).click()
  await pickFileMenuInput(page).setInputFiles(sourcePath)
  if (name !== undefined) {
    await expectUploadDone(page, name, { timeout: 120_000 })
  }
}

export const uploadFolderFromDir = async (page: Page, dirPath: string): Promise<void> => {
  await openUploadMenu(page)
  await page.locator(".uploadmenu").getByRole("menuitem", { name: "フォルダを選択" }).click()
  await pickFolderMenuInput(page).setInputFiles(dirPath)
}

export const expectUploadDone = async (
  page: Page,
  name: string,
  opts: { timeout?: number } = {},
): Promise<void> => {
  const timeout = opts.timeout ?? 30_000
  const row = page.locator(".upcard .urow").filter({ hasText: name })
  await expect(row.locator(".tag.ok")).toHaveText("完了", { timeout })
}

// AUTO_DISMISS_MS = 4000 (app/shell/uploads.tsx); accept up to 10s to absorb
// tick jitter between the 4s dismiss timer and the assertion.
export const expectUploadRowAutoDismissed = async (page: Page, name: string): Promise<void> => {
  const row = page.locator(".upcard .urow").filter({ hasText: name })
  await expect(row).toHaveCount(0, { timeout: 10_000 })
}

// ---------------------------------------------------------------------------
// SDK-side helpers

// Extracts the OIDC access token from the SPA sessionStorage. The key shape is
// `oidc.user:${issuer}:${clientId}`; we scan for the "oidc.user:" prefix
// instead of hardcoding issuer/client so the helper works across environments.
const accessTokenFromPage = async (page: Page): Promise<string> => {
  const token = await page.evaluate(() => {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key === null || !key.startsWith("oidc.user:")) continue
      const raw = sessionStorage.getItem(key)
      if (raw === null) continue
      try {
        const parsed = JSON.parse(raw) as { access_token?: unknown }
        if (typeof parsed.access_token === "string") return parsed.access_token
      } catch {
        continue
      }
    }

    return null
  })
  if (token === null) {
    throw new Error("accessTokenFromPage: no oidc.user:* entry with access_token in sessionStorage")
  }

  return token
}

export const s3ClientForE2e = async (page: Page): Promise<S3Client> => {
  const token = await accessTokenFromPage(page)
  const endpoint = s3Endpoint()
  const sts = new STSClient({ endpoint, region: "us-east-1" })
  const res = await sts.send(new AssumeRoleWithWebIdentityCommand({
    RoleArn: "arn:aws:iam::role/KuraUserRole",
    RoleSessionName: `e2e-${randomBytes(4).toString("hex")}`,
    WebIdentityToken: token,
    DurationSeconds: 3600,
  }))
  const c = res.Credentials
  if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
    throw new Error("s3ClientForE2e: STS returned incomplete credentials")
  }

  return new S3Client({
    endpoint,
    credentials: {
      accessKeyId: c.AccessKeyId,
      secretAccessKey: c.SecretAccessKey,
      sessionToken: c.SessionToken,
    },
    ...SEAWEEDFS_S3_CLIENT_OPTIONS,
  })
}

// Deletes every object under the current run's scope prefix; also drains any
// pending multipart uploads (leftover from a crashed run) and polls until the
// list settles at zero to absorb the eventual-consistency window described in
// scenarios.md §3.3. No-op when KURA_E2E_KEEP_UPLOADS === "1".
export const resetE2eScope = async (page: Page): Promise<void> => {
  if (process.env["KURA_E2E_KEEP_UPLOADS"] === "1") return
  const s3 = await s3ClientForE2e(page)
  const bucket = e2eUsername()
  const prefix = scopePrefix()

  for (let attempt = 0; attempt < 3; attempt++) {
    const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }))
    const keys = (list.Contents ?? []).map((c) => c.Key).filter((k): k is string => !!k)
    if (keys.length > 0) {
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000)
        await s3.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }))
      }
    }

    const mp = await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: prefix }))
    for (const u of mp.Uploads ?? []) {
      if (!u.Key || !u.UploadId) continue
      await s3.send(new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: u.Key,
        UploadId: u.UploadId,
      }))
    }

    if (keys.length === 0 && (mp.Uploads ?? []).length === 0) return
    await new Promise((r) => setTimeout(r, 1_000))
  }

  await clearClientPrefs(page)
}

export const clearClientPrefs = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    try {
      localStorage.removeItem("kura.lang")
      sessionStorage.removeItem("kura.presigned")
    } catch {
      // localStorage inaccessible on about:blank; safe to ignore.
    }
  })
}

export const createFolderViaSdk = async (page: Page, path: string): Promise<void> => {
  // sessionStorage is inaccessible on about:blank; navigate first if needed so
  // the OIDC snapshot injected via addInitScript is available.
  if (!page.url().startsWith(baseUrl())) {
    await page.goto("/")
    await page.locator(".hdr").waitFor({ state: "visible", timeout: 15_000 })
  }
  const s3 = await s3ClientForE2e(page)
  const bucket = e2eUsername()
  const normalized = path.endsWith("/") ? path : `${path}/`
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `${normalized}.keep`,
    Body: "",
    ContentType: "application/octet-stream",
  }))
}

// ---------------------------------------------------------------------------
// modal / share helpers

export const openPresignModalFromRow = async (page: Page, filename: string): Promise<Locator> => {
  const row = getRow(page, filename)
  await row.locator(".pubbtn").click()
  const modal = page.getByRole("dialog", { name: "ファイルを公開" })
  await modal.waitFor({ state: "visible" })
  await modal.getByRole("tablist", { name: "共有モード" }).getByRole("tab", { name: "期限つき" }).click()
  const timedModal = page.getByRole("dialog", { name: "期限つきリンクを発行" })
  await timedModal.waitFor({ state: "visible" })

  return timedModal
}

// ---------------------------------------------------------------------------
// anon (public delivery) helpers

export const getAnon = async (
  browser: Browser,
  urlPath: string,
  init: { headers?: Record<string, string> } = {},
): Promise<{ context: BrowserContext; response: APIResponse }> => {
  const context = await browser.newContext()
  const url = urlPath.startsWith("http") ? urlPath : `${baseUrl()}${urlPath}`
  const response = await context.request.get(url, init.headers ? { headers: init.headers } : {})

  return { context, response }
}

export const waitPublicUrl200 = async (
  browser: Browser,
  urlPath: string,
  expectedBytes?: Buffer,
): Promise<void> => {
  const { context, response } = await getAnon(browser, urlPath)
  try {
    expect(response.status(), `expected 200 from ${urlPath}`).toBe(200)
    if (expectedBytes !== undefined) {
      const body = Buffer.from(await response.body())
      expect(body.equals(expectedBytes), `byte mismatch on ${urlPath}`).toBe(true)
    }
  } finally {
    await context.close()
  }
}

export const waitPublicUrl404 = async (browser: Browser, urlPath: string): Promise<void> => {
  const { context, response } = await getAnon(browser, urlPath)
  try {
    expect(response.status(), `expected 404 from ${urlPath}`).toBe(404)
  } finally {
    await context.close()
  }
}

export const publicUrlFor = (publicBase: string, bucket: string, key: string): string =>
  `${publicBase.replace(/\/+$/, "")}/${bucket}/${keyToUrlPath(key)}`

// ---------------------------------------------------------------------------
// resume / retry helpers (route intercept, closure counter, per-test scoped)

export const stallUploadPart = async (
  page: Page,
  opts: { failCount?: number } = {},
): Promise<void> => {
  // Default 20 exhausts SDK v3 default retry (maxAttempts=3) across all part
  // slots of a small multipart upload (32 MiB = 4 parts × 3 attempts = 12).
  // Callers who want partial failure (e.g. only fail once then succeed) can
  // pass a small failCount, but the RESUME flow expects deterministic failure
  // until unroute.
  const failCount = opts.failCount ?? 20
  let n = 0
  await page.route(/\?partNumber=\d+.*uploadId=/, (route: Route) => {
    if (n++ < failCount) return route.abort("failed")

    return route.continue()
  })
}

export const stallPutObject = async (
  page: Page,
  opts: { failCount?: number; bucket: string; key: string },
): Promise<void> => {
  // Default 5 comfortably exceeds AWS SDK v3 standard retry (maxAttempts=3),
  // so a single stallPutObject call is enough to surface a failed transfer.
  // Callers who want partial failure can pass a smaller failCount.
  const failCount = opts.failCount ?? 5
  const target = `/${opts.bucket}/${keyToUrlPath(opts.key)}`
  let n = 0
  await page.route((url) => url.pathname === target, (route: Route) => {
    if (route.request().method() !== "PUT") return route.continue()
    // multipart UploadPart は partNumber= を含むので除外 (small file の
    // 一発 PUT だけを落とす)
    if (route.request().url().includes("partNumber=")) return route.continue()
    if (n++ < failCount) {
      return route.fulfill({
        status: 500,
        contentType: "application/xml",
        body: "<Error><Code>InternalError</Code><Message>injected</Message></Error>",
      })
    }

    return route.continue()
  })
}

// Adds a per-part delay to UploadPart PUTs so a running multipart upload
// stays in "アップロード中" long enough for the test to observe and cancel
// it. Unlike stallUploadPart (which aborts), this eventually lets each part
// through, so an untouched upload still succeeds — useful for the cancel /
// cancelAll tests that need the upload to be interruptible but not doomed.
export const delayUploadPart = async (
  page: Page,
  opts: { delayMs?: number } = {},
): Promise<void> => {
  const delayMs = opts.delayMs ?? 3_000
  await page.route(/\?partNumber=\d+.*uploadId=/, async (route: Route) => {
    await new Promise((r) => setTimeout(r, delayMs))
    await route.continue()
  })
}

export const withOffline = async (page: Page, fn: () => Promise<void>): Promise<void> => {
  try {
    await page.context().setOffline(true)
    await fn()
  } finally {
    await page.context().setOffline(false)
  }
}

// ---------------------------------------------------------------------------
// tmpdir + medium binary helper

export const makeMediumBinaryFile = async (
  sizeMiB: number,
  seed: number,
): Promise<{ path: string; name: string; buffer: Buffer; cleanup: () => Promise<void> }> => {
  const dir = await mkdtemp(join(tmpdir(), "kura-e2e-"))
  const name = `bin-${sizeMiB}mib-${seed.toString(16).padStart(2, "0")}-${randomBytes(4).toString("hex")}.bin`
  const path = join(dir, name)
  const buffer = Buffer.alloc(sizeMiB * 1024 * 1024, seed & 0xff)
  await writeFile(path, buffer)

  return {
    path,
    name,
    buffer,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

// ---------------------------------------------------------------------------
// resume setup helper (RESUME Domain)

// Creates a pending multipart upload with a subset of parts already uploaded,
// leaving it in the state that a crashed / interrupted upload would leave
// behind. Used by E-RESUME-01 (mismatch reject) where verifyCompletedParts
// needs at least one completed part to detect the ETag mismatch. Returns the
// (bucket, key, uploadId, buffer, partSize) so the test can either resume
// with the same buffer or with a mismatching one of identical size.
export const preparePendingUpload = async (
  page: Page,
  opts: { key: string; sizeMiB: number; uploadedParts: number[]; seed?: number },
): Promise<{ key: string; uploadId: string; buffer: Buffer; partSize: number }> => {
  // sessionStorage は about:blank 上で読み取れないため、fixture の addInitScript
  // で挿入された OIDC snapshot にアクセスできるよう SPA をまず開く。
  // createFolderViaSdk と同じ pattern。
  if (!page.url().startsWith(baseUrl())) {
    await page.goto("/")
    await page.locator(".hdr").waitFor({ state: "visible", timeout: 15_000 })
  }
  const s3 = await s3ClientForE2e(page)
  const bucket = e2eUsername()
  const partSize = 8 * 1024 * 1024
  const total = opts.sizeMiB * 1024 * 1024
  const buffer = Buffer.alloc(total, (opts.seed ?? 0x11) & 0xff)
  const create = await s3.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: opts.key,
  }))
  if (create.UploadId === undefined) throw new Error("preparePendingUpload: no UploadId")
  const uploadId = create.UploadId
  for (const partNumber of opts.uploadedParts) {
    const start = (partNumber - 1) * partSize
    const end = Math.min(start + partSize, total)
    await s3.send(new UploadPartCommand({
      Bucket: bucket,
      Key: opts.key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: buffer.subarray(start, end),
      ContentLength: end - start,
    }))
  }

  return { key: opts.key, uploadId, buffer, partSize }
}

// ---------------------------------------------------------------------------
// audit log observer (S-PUBSERVE-01)

// Reads KURA_LOG_DIR/access-YYYY-MM-DD.log (bind-mounted from the nginx
// container, compose.yml). Polls up to `timeoutMs` for the needle to appear
// AFTER a trailing "\n" (avoids partial-line reads on macOS bind mounts).
export const expectAuditLine = async (needle: string, opts: { timeoutMs?: number } = {}): Promise<void> => {
  const { readFile, stat } = await import("node:fs/promises")
  const logDir = process.env["KURA_LOG_DIR"] ?? "./logs"
  const yyyymmdd = new Date().toISOString().slice(0, 10)
  const path = `${logDir}/access-${yyyymmdd}.log`
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000)

  for (;;) {
    try {
      await stat(path)
      const text = await readFile(path, "utf8")
      if (text.includes(needle) && text.endsWith("\n")) return
    } catch {
      // file may not exist yet on very first request of the day
    }
    if (Date.now() > deadline) {
      throw new Error(`expectAuditLine: needle ${JSON.stringify(needle)} not found in ${path} within ${opts.timeoutMs ?? 10_000}ms`)
    }
    await new Promise((r) => setTimeout(r, 250))
  }
}
