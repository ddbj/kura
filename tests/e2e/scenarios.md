# E2E Scenarios

Playwright を「起動済み dev compose (`docker compose --env-file env.dev --env-file .env up -d --wait`) + DDBJ staging Keycloak + `.env` のテストユーザー」に対して回す。

各シナリオは Persona / 前提 / 手順 / 期待 / 備考 の型。ID と `test(...)` 名を 1:1 で置き、Domain 内 shuffle でも壊れないよう test 間で state を共有しない (state を共有する必要があるものは Domain 単位で `test.describe.configure({ mode: "serial" })` で serial 化 + 内部で self-contained)。

## 1. Personas

| ID | 名前 | 認証 |
|---|---|---|
| P-ANON | 未認証ユーザー | なし (fresh context、cookie / storage 空) |
| P-USER | E2E テストユーザー | staging Keycloak (`kura-dev` client) にログイン済 |

`P-USER` の `preferred_username` は `.env` の `E2E_USERNAME`。この username がそのまま自 bucket 名になり、S3 命名規則を満たすため設定済み (`docs/architecture.md` の「配置」)。

## 2. Domains

| Domain | 接頭辞 | 説明 |
|---|---|---|
| CONFIG | `S-CONFIG` / `E-CONFIG` | nginx の非 SPA endpoint (`/healthz`, `/_config.json`, `/_assets/*`) と SPA fallback |
| AUTH | `S-AUTH` / `E-AUTH` | OIDC sign-in / callback / logout / silent renew / エラー |
| SHELL | `S-SHELL` / `E-SHELL` | Header (wordmark, UserMenu, LangSwitch) と i18n の効果範囲 |
| BROWSE | `S-BROWSE` / `E-BROWSE` | breadcrumb / directory 遷移 / SPA URL 直打ち / empty state / `.keep` 非表示 |
| TOOLBAR | `S-TOOLBAR` / `E-TOOLBAR` | search / lens / sort / quota bar |
| UPLOAD | `S-UPLOAD` / `E-UPLOAD` | file / folder / dropdown / drag & drop / cancel / conflict / retry |
| RESUME | `S-RESUME` / `E-RESUME` | offline 中断 → pending 一覧復元 → 再開 / 破棄 / mismatch reject |
| DOWNLOAD | `S-DOWNLOAD` / `E-DOWNLOAD` | row menu の「ダウンロード」経路 (byte 同一) |
| PUBLISH | `S-PUBLISH` / `E-PUBLISH` | 公開する / 公開を停止 / 公開バッジ / pubpanel / コピー / bulk / 実 200/404 |
| PRESIGN | `S-PRESIGN` / `E-PRESIGN` | 公開する → mode 切替 (`期限つき`) / TTL 選択 / 発行 / expiresAt / 実 GET 200 |
| FILEOPS | `S-FILEOPS` / `E-FILEOPS` | rename / move / copy / delete (single/multi) / folder rename・move・delete / new folder / 公開中 file の rename |
| PUBSERVE | `S-PUBSERVE` / `E-PUBSERVE` | 未認証で公開 URL 直叩き / 特殊文字 / Range / audit log 実観測 |
| FLOW | `S-FLOW` / `E-FLOW` | 複数 Domain を跨ぐ user flow |

## 3. 共通前提 / 環境

### 3.1 対象環境

- **baseURL**: `http://localhost:28080` (`playwright.config.ts` が `KURA_E2E_BASE_URL` を優先)。
- **S3 endpoint**: `http://localhost:28333` (`KURA_S3_ENDPOINT`)。SPA から直接叩き、内部 nginx は proxy しない。
- **`.env`**: gitignored。`E2E_USERNAME` / `E2E_PASSWORD` は必須。
- **globalSetup** (`tests/e2e/global-setup.ts`): 実行冒頭で以下 3 プローブを直列に走らせ、いずれか失敗で `throw` して全 test を即 abort する:
  1. `GET ${baseURL}/healthz` → 200 body `ok\n`
  2. `GET ${baseURL}/_config.json` → 200 + JSON parse 成功 + 5 key 存在
  3. `GET ${oidcIssuer}/.well-known/openid-configuration` → 200
- globalSetup は `KURA_E2E_RUN_ID` を確定する: `process.env.KURA_E2E_RUN_ID ?? crypto.randomBytes(8).toString("hex")`。以降 helper が読む。CI で `${{ github.run_id }}` を渡す場合は上書き優先。
- **`tests/e2e/global-setup.ts`** の存在は `playwright.config.ts` の `globalSetup` オプションで設定。

### 3.2 認証状態管理 (P0 級注意)

Playwright の `storageState()` は **cookie + localStorage のみ** を保存する (Playwright 公式仕様、1.4x-1.6x で不変)。IndexedDB / sessionStorage は保存対象外。react-oidc-context は access token / refresh token を `sessionStorage["oidc.user:${issuer}:${clientId}"]` に置くため、素朴な storageState 再利用では認証状態が復元されない。以下の 2 段構えで解決する:

1. **`auth.setup.ts`** (`setup` project) が Keycloak login → `/_auth/callback` 復帰まで実施。完了後:
   - Playwright の `storageState()` で cookie / localStorage を `tests/e2e/.auth/user.storage.json` に保存 (Keycloak 側 SSO cookie もここに入る)。
   - **Storage API を canonical iteration で叩いて** sessionStorage snapshot を抽出 (下記) し、`tests/e2e/.auth/user.session.json` に **別ファイル** で保存:
     ```
     const snapshot = await page.evaluate(() => {
       const out: Record<string, string> = {}
       for (let i = 0; i < sessionStorage.length; i++) {
         const k = sessionStorage.key(i)!
         out[k] = sessionStorage.getItem(k)!
       }
       return JSON.stringify(out)
     })
     ```
     `JSON.stringify(sessionStorage)` を素直に呼ぶと Chromium version 依存で `"{}"` を返すことがある (Storage は enumerable-own でない iteration semantics)。
2. `chromium-user` project は以下 fixture (`sessionStoragePage`) を default 適用:
   - `use.storageState = "tests/e2e/.auth/user.storage.json"`
   - `beforeEach`: `context.addInitScript((snapshot) => { const data = JSON.parse(snapshot); for (const [k,v] of Object.entries(data)) sessionStorage.setItem(k, v as string) }, sessionSnapshot)` で毎 context に `oidc.user:*` を注入。

`auth.setup.ts` は毎 run で走る (`dependencies: ["setup"]` により Playwright の run 単位で確実に fresh)。手動再取得は不要。実装は §7 参照。

**セキュリティ注意**: `tests/e2e/.auth/*.json` と Playwright trace は staging Keycloak の access_token (12h 有効) / refresh_token (offline 30 日) を平文で含む。`.gitignore` は必須。CI では artifact upload しない。詳細は §3.4 参照。

### 3.3 Test isolation と runId scope

- 全 test は `E2E_USERNAME` の 1 bucket を共有する。並列は禁止 (`fullyParallel: false, workers: 1`)。
- **命名は必ず runId scope の下**に置く:
  - `uniqueName(label)` → `e2e/${runId}/${label}-${hex8}.${ext}` (16 hex chars ≈ 128 bit)
  - `uniquePrefix(label)` → `e2e/${runId}/${label}-${hex8}/`
- **3 段構え cleanup**:
  1. `beforeAll` (per spec file): 自 runId scope (`e2e/${runId}/`) を全掃除。過去 run のゴミがあれば retry 保険で除去。他 runId scope には触らない。
  2. `beforeEach`: 自 runId scope 直下の未 setup object を掃除 (`retries > 0` 時の残置対策)。
  3. `afterEach`: test scope の掃除 (`uniquePrefix(label)` を bulk delete + pending multipart abort)。
- **他 runId のゴミの一斉掃除** は `npm run test:e2e:clean` (`scripts/e2e-cleanup.ts` として提供、手動実行専用) で行う。
- `resetE2eScope(page)` は S3 SDK 直叩きで実装 (§5 参照)。UI 経由の bulk delete は使わない (Modal を開くと副作用がある + 遅い)。
- `localStorage["kura.lang"]` と `sessionStorage["kura.presigned"]` は test の副作用として carry over しやすいので、`afterEach` で必ず削除する (§5 helper `clearClientPrefs(page)`)。
- **SeaweedFS の eventual consistency**: PutObject / DeleteObject 直後の ListObjectsV2 で反映遅延が起こり得る (通常 &lt;1s、まれに 1-2s)。`resetE2eScope` の内部で `ListObjectsV2` → `DeleteObjects` → 再 List で 0 になるまで最大 3 回 poll する。空 state を assertion するシナリオ (S-BROWSE-01) は Playwright auto-retry timeout (`toHaveCount(0, { timeout: 10_000 })`) で吸収。

### 3.4 retry / trace / report / secrets

- `retries: process.env.CI ? 2 : 0` (local は 0 retry で fail-fast、CI は 2)。
- `use.trace = "retain-on-failure"` (**`use` 内**、`defineConfig` トップレベルではない)。失敗時のみ trace 収集。
- `.gitignore` に `tests/e2e/.auth/`, `tests/e2e/playwright-report/`, `tests/e2e/test-results/` を追加する。
- staging Keycloak の一過性 502/503 だけを retry で吸収。
- **セキュリティ (P0)**: Playwright trace は `page.evaluate` の戻り値 (sessionStorage snapshot 含む) と storageState を保持するため、access_token / refresh_token が平文で trace zip に載る。CI で artifact upload すると流出リスク。ポリシー:
  - **local 実行**: trace はホスト cwd の `test-results/` に残す (`.gitignore` 済)。手元でしか開かない。
  - **CI 実行**: `KURA_E2E_TRACE_UPLOAD=false` (default) で artifact upload を無効化。opt-in の場合のみ private repo の short-lived storage に置く。
  - **`.auth/*.json` は絶対 artifact upload しない**。CI では repo secret から生成 or job 内でのみ有効。
  - trace 保護が難しい場合は `use.trace = "off"` default にし、失敗時の diagnose は local 再現に閉じる。

### 3.5 tmpdir と大 file

- 大 file (10-64 MiB) を `setInputFiles` に渡すときは Node の `fs.mkdtemp` で temp dir を作り、helper `makeMediumBinaryFile(sizeMiB, seed)` が `{ path, cleanup }` を返す。`afterEach` で必ず cleanup を呼ぶ。

### 3.6 環境変数一覧

| 変数 | 用途 | 必須 | Default |
|---|---|---|---|
| `E2E_USERNAME` | 主 staging Keycloak テストユーザー名 (= 自 bucket 名) | 必須 | — |
| `E2E_PASSWORD` | 同上パスワード | 必須 | — |
| `E2E_LOGOUT_USERNAME` | S-AUTH-05 用の第 2 テストユーザー (未設定なら S-AUTH-05 skip) | 任意 | — |
| `E2E_LOGOUT_PASSWORD` | 同上パスワード | 任意 | — |
| `KURA_E2E_BASE_URL` | Playwright の baseURL 上書き | 任意 | `http://localhost:28080` |
| `KURA_E2E_S3_ENDPOINT` | S3 API endpoint (SDK helper 用) | 任意 | `http://localhost:28333` |
| `KURA_E2E_RUN_ID` | run 識別子 (CI で固定推奨) | 任意 | globalSetup で自動生成 |
| `KURA_LOG_DIR` | audit log 実観測用 dir | 任意 | `./logs` |
| `KURA_E2E_KEEP_UPLOADS` | 掃除を無効化 (debug 用) | 任意 | 未設定 |
| `KURA_E2E_TRACE_UPLOAD` | CI で trace artifact upload を許可 (default false) | 任意 | `false` |

## 4. 共通 selector 早見表

すべて `Locator.getByRole(...)` の chain で書くこと。`.usermenu getByRole(...)` のような space 連結記法は使わない。

| 要素 | selector |
|---|---|
| Header wordmark (root へ戻る) | `page.locator(".hdr").getByRole("link", { name: "kura" })` |
| UserMenu trigger | `page.locator(".hdr .user")` (accessible name = username) |
| UserMenu 内 logout | `page.locator(".usermenu").getByRole("menuitem", { name: /ログアウト\|Log out/ })` |
| LangSwitch | `page.locator(".lang").getByRole("button", { name: /^(JA\|EN)$/ })` (非選択側は `.off` class) |
| Login button (未認証画面) | `page.getByRole("button", { name: "DDBJ アカウントでログイン" })` |
| Breadcrumb (中間 crumb) | `page.locator(".pathbar .crumb").getByRole("link", { name })` |
| Breadcrumb (末尾 `.cur`) | `page.locator(".pathbar .crumb .cur")` |
| New folder button | `page.locator(".pathbar .actions").getByRole("button", { name: "＋ 新規フォルダ" })` |
| Upload dropdown (pathbar) | `page.locator(".pathbar .actions").getByRole("button", { name: /アップロード/ })` |
| Empty-state upload primary | `page.locator(".emptyzone .ez-actions").getByRole("button", { name: "アップロード" })` |
| Upload menu items | `page.locator(".uploadmenu").getByRole("menuitem", { name })` (`ファイルを選択` / `フォルダを選択`) |
| Search box | `page.getByLabel("ファイル名で絞り込み")` |
| Lens chips | `page.locator(".lens").getByRole("button", { name })` (aria-pressed 判定) |
| Sort column header | `page.locator(".thead").getByRole("button", { name: /^(名前\|サイズ\|更新日)/ })` (`.desc` class = 降順) |
| Select-all checkbox | `page.getByRole("checkbox", { name: "全選択" })` |
| File row | `page.locator(".row.sel:not(:has(.nm.folder))").filter({ hasText: filename })` |
| Folder row | `page.locator(".row.sel:has(.nm.folder)").filter({ hasText: foldername })` |
| Row selection checkbox | `page.getByRole("checkbox", { name: filename + " を選択" })` |
| Row kebab | `page.getByRole("button", { name: filename + " の操作" })` |
| Row menu items | `page.locator(".rowmenu").getByRole("menuitem", { name })` |
| Row publish/unpublish button | row scope 内 `.pubbtn` (text `公開する` / `公開を停止`) |
| Public badge | row scope 内 `.c-pub .tag.ok` (text `公開中`) |
| Presigned badge | row scope 内 `.c-pub .tag.warn` (text `期限つき`) |
| Pub panel URL | row 展開後 `.pubpanel .linkbar .u` |
| Presign panel URL | row 展開後 `.presignpanel .linkbar .u` |
| LinkBar copy button | 対象 panel 内 `.linkbar .cp` (text `コピー` / `コピー済み`) |
| Bulk bar (file list) | `page.locator(".row.sel").locator("xpath=..").locator(".bulkbar").getByRole("button", { name })` (pending-uploads card 内の `.bulkbar` と衝突するため、必ず file list scope を絞る。実務上は `page.locator(".card:not(:has([data-testid=\"pending-uploads\"])) .bulkbar")` でも可) |
| Pending uploads card | `page.locator("[data-testid=\"pending-uploads\"]")` |
| Pending uploads bulk header | 上記内 `.bulkbar b` (text `再開待ちのアップロード` を含む) |
| Pending row 再開 | 上記内 `getByRole("button", { name: "再開" })` |
| Pending row 破棄 | 上記内 `getByRole("button", { name: "破棄" })` |
| Modal | `page.getByRole("dialog", { name })` (name は `<b id>` の text) |
| Modal confirm submit | modal scope 内 `getByRole("button", { name: submitLabel })` (`削除` / `変更` / `作成` / `コピー` / `移動` / `公開する` / `リンクを発行`) |
| Modal cancel | modal scope 内 `getByRole("button", { name: "キャンセル" })` |
| Modal name-entry input | modal 内 `getByLabel(inputLabel)` (`新しい名前` / `コピー後の名前` / `フォルダ名`) |
| ShareModal mode 切替 | modal 内 `getByRole("tablist", { name: "共有モード" }).getByRole("tab", { name })` (`公開` / `期限つき`) |
| ShareModal TTL 選択 | modal 内 `getByRole("tablist", { name: "有効期限" }).getByRole("tab", { name })` (`15分` / `1時間` / `12時間`) |
| Upload tray | `page.locator(".upcard")` (rows `.urow`) |
| Drop overlay | `page.locator(".dropov")` (text `ここにドロップしてアップロード`) |
| Over-quota banner | `page.locator(".banner.red")` text 部分一致 `容量が上限に達しています` |
| Flash red callout | browse ページ内 `[role="alert"]` (text で分岐) |
| Flash ok/warn callout | browse ページ内 `[role="status"]` |
| RequireAuth error callout | `[role="alert"]` (text `ログインに失敗しました` 等を含む) |
| Callback error `<p>` | `[role="alert"]` (text `ログインに失敗しました`) |

**注記**:
- MoveModal / FolderMoveModal に「移動先」`<input>` は無い (`<div className="lbl">移動先</div>` + 表示 span、宛先は `選ぶ…` → FolderPicker で選ぶ)。
- 公開切替は `role=switch` ではなく Button + Tag。`.pubbtn` を text で切り替える。
- Focus assertion は `await expect(locator).toBeFocused()` に統一 (`document.activeElement` を evaluate しない)。
- SortButton の方向は class `.desc` のみで、`aria-sort` は無い。可能なら実行前後の row 順を比較して判定。

## 5. Test-fixture (helpers / project)

### 5.1 `tests/e2e/_helpers.ts`

- 環境 / 命名
  - `requireEnv(name)`, `e2eUsername()`, `e2ePassword()`, `runId()` (globalSetup が確定した値を module load 時に取得)
  - `uniqueName(label, ext?)` → `e2e/${runId}/${label}-${hex}.${ext ?? "txt"}` (key path 相対)
  - `uniquePrefix(label)` → `e2e/${runId}/${label}-${hex}/`
  - `uniqueFolder(label)` → `e2e-${label}-${hex}` (folder name のみ、path なし)
- Selector
  - `getRow(page, filename)` / `getFolderRow(page, foldername)`
  - `openRowMenu(page, filename)` / `openFolderMenu(page, foldername)` (kebab click → `.rowmenu` 可視待ち)
  - `openUploadMenu(page)` → メニューが可視化した Locator を返す
- Upload (**注**: `.uploadmenu` は menu items のみで hidden `<input>` を含まない。`<HiddenFileInput ref={fileInputRef} />` は `.pathbar .actions` 内、`<HiddenFileInput ref={pendingResumeInputRef} />` は `[data-testid="pending-uploads"]` 内。scope を厳密に分ける)
  - `pickFileMenuInput(page)` → `page.locator('.pathbar .actions input[type=file]:not([webkitdirectory])')` を 1 個返す
  - `pickFolderMenuInput(page)` → `page.locator('.pathbar .actions input[type=file][webkitdirectory]')`
  - `pickPendingResumeInput(page)` → `page.locator('[data-testid="pending-uploads"] input[type=file]')`
  - `pickEmptyStateInput(page)` → S-UPLOAD-02 の empty-state primary button は `fileInputRef` を click するので、`pickFileMenuInput` を再利用
  - `uploadTextFile(page, name, content)` → `.upcard` に該当 row の `完了` tag を待つ
  - `uploadFileFromPath(page, sourcePath)` (大 file 用)
  - `uploadFolderFromDir(page, dirPath)`
  - `expectUploadDone(page, name, { timeout = 30_000 } = {})` → `.upcard .urow` 該当行の `.tag.ok` `完了` を待つ
  - `expectUploadRowAutoDismissed(page, name)` → 該当 `.urow` が **10s 以内に** 消えることを assertion (`AUTO_DISMISS_MS = 4000` の race を吸収)
- Isolation / cleanup
  - `s3ClientForE2e(page)` → `page.evaluate` で sessionStorage の `oidc.user:*` から access token を取り、`STSClient({ endpoint: KURA_E2E_S3_ENDPOINT, region: "us-east-1" })` で `AssumeRoleWithWebIdentityCommand` を叩き、返された credentials で `S3Client({ endpoint: KURA_E2E_S3_ENDPOINT, region: "us-east-1", forcePathStyle: true, credentials })` を返す。SeaweedFS の STS は S3 と同じ endpoint / host / port (dev では `http://localhost:28333`)。参照実装は `app/lib/s3/credentials.ts:createStsCredentialsProvider`。
  - `resetE2eScope(page)`:
    1. `s3ClientForE2e(page)` で S3 client を取得
    2. `ListObjectsV2({ Bucket, Prefix: "e2e/" + runId() + "/" })` → `DeleteObjectsCommand` batch 1000
    3. `ListMultipartUploadsCommand({ Bucket, Prefix: "e2e/" + runId() + "/" })` → 各 upload に `AbortMultipartUploadCommand`
    4. 再 List → 空になるまで最大 3 回 poll (1s interval、SeaweedFS eventual consistency 対策)
    5. `clearClientPrefs(page)`
  - `clearClientPrefs(page)` → `page.evaluate(() => { localStorage.removeItem("kura.lang"); sessionStorage.removeItem("kura.presigned"); })`
  - `createFolderViaSdk(page, path)` (`.keep` marker を PutObject する SDK helper。`S-BROWSE-06` 等で使う)
  - `expandRow(page, filename)` → row の `.c-size` セル (非 interactive) をクリックして `.pubpanel` or `.presignpanel` を可視化 (S-PUBLISH-01 / S-FILEOPS-10 で必須)
- Modal
  - `openPresignModalFromRow(page, filename)` → row の `公開する` を click → ShareModal open (`ファイルを公開`) 待ち → `共有モード` tablist の `期限つき` tab click → modal title が `期限つきリンクを発行` に変わるのを待つ → modal Locator を返す
- Public / Presign
  - `getAnon(baseURL, urlPath)` → `browser.newContext({ storageState: undefined })` で fresh anon context を作り `context.request.get(urlPath)` を叩き、response を返す。呼び出し側の `await using` で context.close()
  - `waitPublicUrl200(baseURL, urlPath, expectedBytes?)` / `waitPublicUrl404(baseURL, urlPath)` → 上記経由で 200/404 を assertion (byte 比較 optional)
- Resume / retry 補助 (route intercept は closure counter で per-test 独立化。route は context に紐づくので `afterEach` で `page.unroute` を呼ぶ)
  - `stallUploadPart(page, { failCount = 1 } = {})`:
    ```
    let n = 0
    await page.route(/\?partNumber=\d+.*uploadId=/, (route) => {
      if (n++ < failCount) return route.abort("failed")
      return route.continue()
    })
    ```
    multipart UploadPart 経路 (10 MB 以上) のみに効く。offline に頼らず deterministic。
  - `stallPutObject(page, { failCount = 1, bucket, key })`: small file 経路 (`PUT /${bucket}/${key}` without `partNumber` query) の最初の N 回を 500 で fulfill。E-UPLOAD-04 (small file の失敗 → 再試行) で使う。
  - `withOffline(page, fn)` → `try { await page.context().setOffline(true); await fn() } finally { await page.context().setOffline(false) }`
- 大 file
  - `makeMediumBinaryFile(sizeMiB, seed)` → `{ path, buffer, cleanup }`。afterEach で cleanup 必須
- Focus / clipboard
  - `chromium-user` project の `use.permissions = ["clipboard-read", "clipboard-write"]` を統一適用 (fresh anon context を作る test は permissions が乗らないが、それらは clipboard を使わない)

### 5.2 project 構成 (`playwright.config.ts`)

```
projects:
  - name: "setup", testMatch: /auth\.setup\.ts$/
  - name: "chromium-anon", testMatch: /\.spec\.ts$/, testIgnore: [/\.user\.spec\.ts$/, /auth\.setup\.ts$/]
  - name: "chromium-user", testMatch: /\.user\.spec\.ts$/, dependencies: ["setup"],
    use: { storageState: "tests/e2e/.auth/user.storage.json", permissions: ["clipboard-read", "clipboard-write"], trace: "retain-on-failure" }
```

- **`chromium-user-first-visit` は不要** (S-AUTH-04 が「HeadBucket 発火のみ pin、CreateBucket は integration に譲る」を採用したため、fresh user は不要)。
- `sessionStoragePage` fixture (`beforeEach` で `addInitScript` を注入する custom fixture) は `chromium-user` に適用。実装は `tests/e2e/fixtures.ts`。
- **PUBSERVE Domain は `chromium-user` project に置く** (`pubserve.user.spec.ts`)。理由: fresh anon context を叩くには先に P-USER で publish 済 object を作る必要があり、setup を `chromium-user` の authenticated context で行い、assertion は test 内で `browser.newContext({ storageState: undefined })` を作って anon 相当で叩く形が最も直截的。`chromium-anon` の Password Grant 対応は不要。

### 5.3 Domain と spec file の対応

| Domain | spec file | project |
|---|---|---|
| CONFIG | `config.spec.ts` | chromium-anon |
| AUTH (anon) | `auth.spec.ts` | chromium-anon |
| AUTH (user) | `auth.user.spec.ts` | chromium-user |
| SHELL | `shell.user.spec.ts` | chromium-user |
| BROWSE | `browse.user.spec.ts` | chromium-user |
| TOOLBAR | `toolbar.user.spec.ts` | chromium-user (Domain 内 serial) |
| UPLOAD | `upload.user.spec.ts` | chromium-user |
| RESUME | `resume.user.spec.ts` | chromium-user |
| DOWNLOAD | `download.user.spec.ts` | chromium-user |
| PUBLISH | `publish.user.spec.ts` | chromium-user |
| PRESIGN | `presign.user.spec.ts` | chromium-user |
| FILEOPS | `fileops.user.spec.ts` | chromium-user |
| PUBSERVE | `pubserve.user.spec.ts` | chromium-user (setup で publish 済 object を作り、test 内 fresh anon context で叩く) |
| FLOW | `flow.user.spec.ts` | chromium-user |

`test.describe` を Domain 名、`test` 名を `S-DOMAIN-XX: ...` の書式で ID と 1:1。

---

## CONFIG Domain

### S-CONFIG-01: `/healthz` が 200 `ok\n` を返す

- **ペルソナ**: P-ANON
- **前提**: dev compose が globalSetup 通過
- **手順**:
  1. `page.request.get("/healthz")` を叩く
- **期待**:
  - status 200
  - body が `ok\n`
- **備考**: nginx `location = /healthz` (`nginx/kura.conf.template:46-48`)。

### S-CONFIG-02: `/_config.json` は SPA runtime 設定を JSON で返す

- **ペルソナ**: P-ANON
- **手順**:
  1. `page.request.get("/_config.json")`
- **期待**:
  - status 200、`Content-Type` が `application/json`
  - JSON に `oidcIssuer` / `oidcClientId` / `s3Endpoint` / `publicBase` / `fileTtlDays` の 5 key があり、すべて string 型
  - `oidcIssuer` が非空 (env に注入されている)、`oidcClientId` も非空、`fileTtlDays` は空文字 (dev では TTL 無効) または `[1-9][0-9]*` の数字 string
- **備考**: 具体値 (`kura-dev`) を assertion で hardcode しない。dev / staging / production いずれでも通る shape 検証に留める。

### S-CONFIG-03: SPA route の URL 直打ちで index.html が 200 で返る

- **ペルソナ**: P-ANON
- **手順**:
  1. `/_browse/foo/bar/` を直接 `page.request.get`
  2. `/_auth/callback?code=x&state=y` を直接 `page.request.get`
- **期待**:
  - どちらも 200 / `<title>kura</title>` を body に含む / `Cache-Control: no-cache` / `Content-Type: text/html`
- **備考**: SPA が実際に routing することは AUTH / BROWSE で追検。

### E-CONFIG-01: nginx location にマッチしない path は 404

- **ペルソナ**: P-ANON
- **手順**:
  1. `page.request.get("/" + e2eUsername() + "/")` (自 bucket、path 部空)
  2. `page.request.get("/username_that_is_not_public/anything.txt")` (`_` を含む → username regex にマッチしない)
- **期待**:
  - どちらも 404
- **備考**:
  - 手順 1 の根拠: nginx `location ~ ^/(?<kura_user>[a-z0-9][a-z0-9.-]{1,62})(?<kura_path>.+)$` の path 部 `.+` に空文字がマッチしない (`nginx/kura.conf.template:86`)。
  - 手順 2 の根拠: username 部 `[a-z0-9][a-z0-9.-]{1,62}` に `_` を含む文字列がマッチしない。

### E-CONFIG-02: `_` 始まりのパスは 404

- **ペルソナ**: P-ANON
- **手順**:
  1. `page.request.get("/_notaroute/anything.txt")`
- **期待**: status 404
- **備考**: `_` は username regex の先頭 `[a-z0-9]` にマッチしない。SPA fallback (`/_browse`, `/_auth`, `/_assets`, `/_config.json`) は明示的な location で吸収されるが、それ以外の `/_...` は絶対に配信しない。

---

## AUTH Domain

### S-AUTH-01: 未認証で `/` を開くと LoginBox が表示される

- **ペルソナ**: P-ANON
- **手順**:
  1. `/` を goto
- **期待**:
  - `page.locator(".loginbox")` 可視 (literal text `大容量ファイルの保管・共有`)
  - `getByRole("button", { name: "DDBJ アカウントでログイン" })` 可視 (1 個)
  - `page.locator(".hdr")` は非可視 (Header は login 画面では描画されない、`shell-layout.tsx`)
- **備考**: `RequireAuth` の signed-out fallback (`browse-page.tsx:69-73`)。

### S-AUTH-02: ログインボタンで Keycloak にリダイレクトされる

- **ペルソナ**: P-ANON
- **手順**:
  1. `/` を goto
  2. `getByRole("button", { name: "DDBJ アカウントでログイン" })` をクリック
  3. `page.waitForURL(url => new URL(url).hostname === new URL(oidcIssuer).hostname)`
- **期待**:
  - URL host が `oidcIssuer` と一致、pathname が `/realms/master/protocol/openid-connect/auth`
  - query に `response_type=code`, `code_challenge_method=S256`, `code_challenge` (非空), `client_id` (非空), `scope=openid`, `redirect_uri` が baseURL + `/_auth/callback` (末尾一致), `state` (非空)
- **備考**: `signinRedirect({ state: location.pathname + location.search })` (`require-auth.tsx:20`)。

### S-AUTH-03: Keycloak login → callback → `/` 復帰

- **ペルソナ**: P-ANON → P-USER 昇格
- **手順**:
  1. `/` を goto
  2. 「DDBJ アカウントでログイン」をクリック
  3. Keycloak login form (`#username` に fallback `input[name=username]`、`#password` / `input[name=password]`、`#kc-login` / `button[name=login]`) にテストユーザーを入力して submit
  4. `/_auth/callback?...` に戻ってきたら `<Navigate to="/" replace />` が動き、`.hdr` が可視化するまで待つ
- **期待**:
  - `new URL(page.url()).pathname === "/"` かつ `hash === ""` かつ `search === ""` (Navigate replace で history 置換)
  - `page.locator(".hdr .wordmark")` (accessible name `kura`) と `.hdr .user` (accessible name = `E2E_USERNAME`) が可視
- **備考**: この完了状態を storageState (cookie + localStorage) と sessionStorage snapshot に分けて `.auth/*.json` に保存するのが `auth.setup.ts` の役割。個別 test で毎回 Keycloak を踏まない。

### S-AUTH-04: 初回訪問で HeadBucket → CreateBucket → list が発行される

- **ペルソナ**: P-USER (但し bucket 未作成状態の `chromium-user-first-visit` project)
- **前提**: `resetE2eScope` は SDK 経由で bucket 内 object を空にできても bucket 自体を削除できない (IAM policy 上、DeleteBucket を許可していない前提)。したがってこの test は「fresh test user (bucket 未作成)」を staging Keycloak に用意し、`chromium-user-first-visit` project で 1 度だけ走らせる。他 P-USER test は先に `auth.setup.ts` + 通常訪問済みの user を使う。
- **代替 (test user が 1 個しかない場合)**: HeadBucket の実発行だけ観測し、CreateBucket の呼び出しは `page.route()` で 404 応答を fake して確認する条件付き分岐にする。この場合は draft §6 Non-goals に「初回 CreateBucket の実観測は integration `s3-flows.test.ts` に譲る」と明記し、S-AUTH-04 は HeadBucket 発行 assertion のみに縮小する。
- **本 draft 採用**: 代替案 (HeadBucket 発行のみ)。手順:
  1. `/` を goto
  2. `page.waitForRequest((req) => req.method() === "HEAD" && req.url().endsWith("/" + username))` を待つ
- **期待**:
  - HEAD リクエスト発行が観測できる
  - `.hdr .user` が可視 (username 表示)
  - `.pathbar .crumb .cur` が username
  - `.upcard` が `toHaveCount(0)` (upload 履歴なし)
- **備考**: CreateBucket の 200 応答自体は integration `s3-flows.test.ts` が担保。E2E は SPA 起動時の HeadBucket 発火を UI 層で pin する。

### S-AUTH-05: fresh login → logout → LoginBox 復帰 (完全独立 test)

- **ペルソナ**: P-ANON → P-USER (test 内で完結)
- **前提**: この test は **`.env` の第 2 テストユーザー (`E2E_LOGOUT_USERNAME` / `E2E_LOGOUT_PASSWORD`)** で回す。主 P-USER の storageState と staging Keycloak side session に触れない。第 2 ユーザーが用意できない場合は本 test を `test.skip(!process.env.E2E_LOGOUT_USERNAME, "logout requires dedicated test user")` で skip。
- **手順** (test 内で isolated context を用意):
  1. `const ctx = await browser.newContext()` (storageState なし、fresh)
  2. `const page = await ctx.newPage()`
  3. `/` を goto → LoginBox
  4. 「DDBJ アカウントでログイン」→ Keycloak form に第 2 ユーザーを入力 → login
  5. callback → `/` 復帰 → `.hdr .user` 可視
  6. `.hdr .user` クリック → UserMenu → `getByRole("menuitem", { name: /ログアウト\|Log out/ })` クリック
  7. Keycloak logout 経由で `post_logout_redirect_uri` (= origin) に戻る
  8. LoginBox 可視化を待つ
  9. `await ctx.close()`
- **期待**:
  - 手順 8 で `getByRole("button", { name: "DDBJ アカウントでログイン" })` 可視
  - 主 test user の Keycloak session に副作用が及ばない (第 2 ユーザーの SSO session_state だけが invalidate される)
- **備考**: **Keycloak `end_session_endpoint` の RP-initiated logout は id_token_hint に紐づく server-side session を invalidate する**。同一 storageState を isolated context に load して logout すると、以降同一 storageState を使う test の silent renew (refresh_token grant) が「session が存在しない」で `login_required` を返し全滅する。したがって「isolated context 内のみ」の想定は誤りで、必ず第 2 ユーザー or fresh login 経路で行う必要がある。

### E-AUTH-01: callback で `error=access_denied` が付いていた場合、エラーメッセージが出る

- **ペルソナ**: P-ANON
- **手順**:
  1. `/_auth/callback?error=access_denied&error_description=denied&state=x` を直接 goto
- **期待**:
  - `getByRole("alert")` に text `ログインに失敗しました` (`t("auth.errorTitle")`) を含む
  - text link `トップへ戻る` (`role=link`) 可視、href `/`
- **備考**: `oidc-client-ts` の error message は version 依存で変わり得る。前段 `ログインに失敗しました` だけを substring 一致で確認。

### E-AUTH-02: callback error 画面の「トップへ戻る」で `/` に戻ると RequireAuth のエラー Callout が持続する

- **ペルソナ**: P-ANON
- **前提**: E-AUTH-01 のエラー状態 (test 単体で完結、依存しない)
- **手順**:
  1. `/_auth/callback?error=access_denied&state=x` を直接 goto
  2. `トップへ戻る` link をクリック
- **期待**:
  - URL が `/`
  - `[role="alert"]` に text `ログインに失敗しました` (RequireAuth の error 分岐、`require-auth.tsx:26-35`)
  - `getByRole("button", { name: "再試行" })` 可視
- **備考**: `auth.error` は AuthProvider の内部 state に持続するため、`/` に戻っても RequireAuth の error 分岐 (Callout + 再試行) が render される。LoginBox (unauthenticated fallback) には遷移しない。`safeReturnTo` は same-origin only。

### E-AUTH-03: SPA route を未認証で叩くと LoginBox にリダイレクトされ、ログイン後は元 URL に戻る

- **ペルソナ**: P-ANON → P-USER 昇格
- **前提**: fresh context (storageState なし)
- **手順**:
  1. `/_browse/some-dir/` を直接 goto
  2. LoginBox 可視を確認
  3. 「DDBJ アカウントでログイン」→ Keycloak login → callback
- **期待**:
  - callback 後 URL が `/_browse/some-dir/` に戻る
  - `.hdr .user` が可視 (認証確立)
- **備考**: `signinRedirect({ state: pathname + search })` → `safeReturnTo(state)`。crumb text の詳細は BROWSE Domain (S-BROWSE-06) が担保するので、AUTH では URL 復帰 + 認証確立のみを pin する。

### E-AUTH-04: bucket 初期化失敗のときエラー Callout が出る

- **ペルソナ**: P-USER
- **前提**: `page.route()` で以下 2 種の response を intercept:
  - `HEAD /${username}` のみ 404 で fulfill (bucket が未作成状態と偽装)
  - `PUT /${username}` (bucket 名 exact match) を 500 で fulfill
  - method + path exact match で、`PUT /${username}/<key>` 等の PutObject / PutObjectTagging を誤爆しない
- **手順**:
  1. `/` を goto
- **期待**:
  - `[role="alert"]` 可視、text `領域の初期化に失敗しました` を含む
  - callout 内 `getByRole("button", { name: "再試行" })` が可視
- **備考**: retry ボタン押下による復帰は unit `browse-page.test.tsx` に譲る。E2E は UI 出現のみ確認。

---

## SHELL Domain

### S-SHELL-01: Header wordmark で `/` に戻る

- **ペルソナ**: P-USER
- **前提**: 事前に `createFolderViaSdk("nav-01")` で folder を作り、そこに移動する
- **手順**:
  1. `/_browse/nav-01/` に移動
  2. `.hdr .wordmark` (name `kura`) をクリック
- **期待**:
  - URL `/`、`.pathbar .crumb .cur` が username

### S-SHELL-02: UserMenu 開閉と outside-click

- **ペルソナ**: P-USER
- **手順**:
  1. `/` を開く
  2. `.hdr .user` クリック → `.usermenu` (`role=menu`) 可視
  3. `.wrap` の空領域をクリック
- **期待**:
  - 手順 2 で `.usermenu` 可視、`.hdr .user` の `aria-expanded="true"`
  - 手順 3 で `.usermenu` 非可視、`aria-expanded="false"`

### S-SHELL-03: UserMenu を Escape で閉じ、focus が trigger に戻る

- **ペルソナ**: P-USER
- **手順**:
  1. UserMenu を開く
  2. `page.keyboard.press("Escape")`
- **期待**:
  - `.usermenu` 非可視
  - `expect(page.locator(".hdr .user")).toBeFocused()`

### S-SHELL-04: LangSwitch で EN に切替 → i18n 効果範囲が明確

- **ペルソナ**: P-USER
- **手順**:
  1. `/` を開く
  2. `.lang` の `EN` button クリック
  3. `.hdr .user` を開いて UserMenu 表示
- **期待**:
  - `document.documentElement.lang === "en"`
  - UserMenu の menuitem text が `Log out`
  - `localStorage["kura.lang"] === "en"`
  - **効果範囲外**: browse ページの `.pathbar .actions` の button text が `＋ 新規フォルダ` / `アップロード` のまま (literal ja 固定、frontend.md §11)
  - **negative assertion**: `getByRole("button", { name: "Upload" })` が 0 件、`＋ 新規フォルダ` は依然可視
- **備考**: i18n が適用されるのは RequireAuth loading/error, AuthCallback, UserMenu の 3 箇所のみ。これはオープンな UX 決定で仕様不整合ではないため、E2E で明示的に「効果範囲」を pin する。`afterEach` で `clearClientPrefs` を呼び他 test に carry over させない。

### S-SHELL-05: `?lang=en` 直打ちで one-shot 上書き

- **ペルソナ**: P-USER
- **手順**:
  1. `/?lang=en` を goto
- **期待**:
  - URL が `/` (query が stripped)
  - `document.documentElement.lang === "en"`
- **備考**: `lang-context.tsx:31-40`。cookie は使わない。

---

## BROWSE Domain

### S-BROWSE-01: runId scope で empty state が表示される

- **ペルソナ**: P-USER
- **前提**: `beforeAll` で `resetE2eScope` 済 → 自 runId scope (`e2e/${runId}/`) が空
- **手順**:
  1. `/_browse/e2e/${runId}/` を goto
- **期待**:
  - `.emptyzone .ez-title` text `まだファイルがありません`
  - `.ez-actions` primary button (`アップロード`) 可視
  - `.pathbar .crumb .cur` text = `${runId}`
- **備考**: root (username) 直下は他 test / 過去残留の影響を受けるので、runId scope で empty state を確認。

### S-BROWSE-02: 新規フォルダを作ると `.keep` は非表示、folder 行だけ

- **ペルソナ**: P-USER
- **手順**:
  1. `/` を開く
  2. `＋ 新規フォルダ` クリック → modal (`role=dialog`, name `新しいフォルダ`)
  3. `getByLabel("フォルダ名")` に `uniqueFolder("browse-02")` を入力
  4. modal 内 `getByRole("button", { name: "作成" })` を押す
- **期待**:
  - modal 閉じ、folder row (`.row.sel:has(.nm.folder)` で名前一致) が 1 行増える
  - 同 prefix 下に `.keep` file row は現れない
- **備考**: SPA が `.keep` を hide (`browse-page.tsx:839`)。

### S-BROWSE-03: フォルダクリックでサブディレクトリに入り、breadcrumb が延びる

- **ペルソナ**: P-USER
- **前提**: S-BROWSE-02 で作った folder が存在 (self-contained なら test 冒頭で `createFolderViaSdk`)
- **手順**:
  1. folder row の `.c-name .nm.folder` (button) をクリック
- **期待**:
  - URL が `/_browse/${encodeURIComponent(folderName)}/`
  - 中間 crumb `getByRole("link", { name: username })`、末尾 `.cur` text = folder name
  - empty state 可視 (folder は作られたばかり)

### S-BROWSE-04: breadcrumb の中間 crumb で親に戻る

- **ペルソナ**: P-USER
- **前提**: `createFolderViaSdk("browse04/child")` で 2 段ネスト
- **手順**:
  1. `/_browse/browse04/child/` を goto
  2. `.pathbar .crumb` の中間 `getByRole("link", { name: "browse04" })` をクリック
- **期待**:
  - URL `/_browse/browse04/`
  - `.pathbar .crumb .cur` text = `browse04`

### S-BROWSE-05: ブラウザ戻る / 進むが SPA history と整合

- **ペルソナ**: P-USER
- **前提**: `/_browse/browse04/child/` で開始 → `browse04` に戻る → 再度 `child` に入る
- **手順**:
  1. `page.goBack()`
  2. `page.goForward()`
- **期待**:
  - `expect(page.locator(".pathbar .crumb .cur")).toHaveText("browse04")` (auto-retry で React re-render を待つ)
  - `expect(...).toHaveText("child")` after goForward

### S-BROWSE-06: URL 直打ちで深い prefix に遷移

- **ペルソナ**: P-USER
- **前提**: `createFolderViaSdk("urlpath/child")` (SDK helper で `.keep` を put)
- **手順**:
  1. `/_browse/urlpath/child/` を直接 goto
- **期待**:
  - crumb が root → `urlpath` → `child` (末尾 `.cur`)
  - empty state 可視

### E-BROWSE-01: 存在しない prefix を直打ちしても空 folder として表示される

- **ペルソナ**: P-USER
- **手順**:
  1. `/_browse/never-existed-${hex}/` を直接 goto
- **期待**:
  - HTTP status 200 (SPA fallback)
  - `.pathbar .crumb .cur` text = `never-existed-${hex}`
  - `.emptyzone` 可視、`toHaveCount(0)` for `.row.sel`

---

## TOOLBAR Domain

`test.describe.configure({ mode: "serial" })` で serial 化。各 test が **self-contained** に upload + 状態を作り、beforeAll には集約しない (shuffle / -g 単発実行対応のため)。

### S-TOOLBAR-01: 検索で substring 一致 filter

- **ペルソナ**: P-USER
- **手順**:
  1. `uploadTextFile(page, uniqueName("tb01-A"), "a")` と `uniqueName("tb01-B")` を 2 file 上げる
  2. search box (`getByLabel("ファイル名で絞り込み")`) に `tb01-A` の一部を入力
- **期待**:
  - `.row.sel:not(:has(.nm.folder))` で name が `tb01-A...` を含む行のみ可視
  - 空入力で全 file row 復活

### S-TOOLBAR-02: 検索ヒット 0 で「一致するファイルはありません」→ `検索をクリア` で復帰

- **ペルソナ**: P-USER
- **手順**:
  1. 1 file だけ upload
  2. search box に `zzz-no-match-${hex}` を入力
- **期待**:
  - `.empty` scope 内 `h2` の text `「zzz-no-match-...」に一致するファイルはありません`
  - `.empty` scope 内 `getByRole("button", { name: "検索をクリア" })` を押す → search box が空、file row 復活

### S-TOOLBAR-03: lens `公開中` で公開 file のみに絞る

- **ペルソナ**: P-USER
- **手順**:
  1. 2 file upload、1 file だけ `openShare` → 公開する
  2. `.lens` の `公開中` chip をクリック
- **期待**:
  - clicked chip の `aria-pressed="true"`
  - 可視 `.row.sel` の全てが `.c-pub .tag.ok` `公開中` を含む
  - 他 chip (`すべて`, `期限つき`) の `aria-pressed="false"`

### S-TOOLBAR-04: lens `期限つき` で presigned のみ (self-contained)

- **ペルソナ**: P-USER
- **手順**:
  1. 1 file upload
  2. `openPresignModalFromRow(page, filename)` で ShareModal(temp) を開き `リンクを発行` 押す → `完了` → 閉じる
  3. `.lens` の `期限つき` chip をクリック
- **期待**:
  - clicked chip の `aria-pressed="true"`
  - 可視 row 全てが `.c-pub .tag.warn` `期限つき`
- **備考**: sessionStorage `kura.presigned` は同 page context 内で保持。`afterEach` の `clearClientPrefs` で確実に削除。

### S-TOOLBAR-05: sort カラムで並び順が変わる

- **ペルソナ**: P-USER
- **手順**:
  1. 3 file upload (upload 順で updated 昇順)、名前は `sort-a`, `sort-b`, `sort-c`
  2. `.thead` の `名前` sort button クリック
  3. `サイズ` sort button クリック
- **期待**:
  - 名前 sort 後、先頭 row と末尾 row の name が入れ替わっていること (asc/desc の実装 detail は問わず、順序が変わることを確認)
  - サイズ sort 後、`.desc` class が付与された sort button が「サイズ」に切替

### S-TOOLBAR-06: quota bar の可視 (over-quota banner は Non-goals)

- **ペルソナ**: P-USER
- **手順**:
  1. `/` を開く
- **期待**:
  - `.toolbar .quota` 内に text `使用量` と `<b>` (`used / total`) が可視
  - `.banner.red` (over-quota banner) が 0 件
- **備考**: over-quota banner は §6 Non-goals (unit で担保)。

---

## UPLOAD Domain

### S-UPLOAD-01: `ファイルを選択` メニューで単一 file を upload

- **ペルソナ**: P-USER
- **手順**:
  1. upload dropdown を開く
  2. `ファイルを選択` menu item をクリック
  3. `pickFileMenuInput(page)` に `setInputFiles({ name, mimeType, buffer })`
  4. `expectUploadDone(page, name)` (`.upcard .urow` の `.tag.ok` `完了` を 30s 以内に待つ)
- **期待**:
  - upload row の state tag `.tag.run` `アップロード中` → `.tag.ok` `完了`
  - 一覧に file row が 1 行増え、size 一致
  - `expectUploadRowAutoDismissed(page, name)` (10s 以内に `.upcard .urow` が該当行を持たなくなる)
- **備考**: HiddenFileInput は 3 系統並存するため、helper が scope 分離した input に setInputFiles する。auto-dismiss の 4s tick と test 実行 tick の race を 10s 上限で許容。

### S-UPLOAD-02: `.emptyzone` の primary button で upload

- **ペルソナ**: P-USER (`beforeAll` で `resetE2eScope` 済、runId scope に navigate)
- **手順**:
  1. `/_browse/e2e/${runId}/` を goto
  2. `.emptyzone .ez-actions` の `アップロード` primary button をクリック
  3. hidden input に setInputFiles
  4. `expectUploadDone`
- **期待**: S-UPLOAD-01 と同じ完了状態
- **備考**: empty state 専用 button (dropdown を経由しない)。

### S-UPLOAD-03: drag & drop で file を upload

- **ペルソナ**: P-USER
- **手順**:
  1. `browse` scope の `.wrap` に対して `page.evaluateHandle` で作った `DataTransfer` を dispatch:
     - `dragenter` → `dragover` (React の onDragOver が state 更新) → `.dropov` 可視待ち → `drop`
  2. `expectUploadDone`
- **期待**:
  - `dragover` 発火後 `.dropov` 可視 (text `ここにドロップしてアップロード`)
  - drop 後、`.dropov` 非可視、file row 1 行増える
- **備考**: Playwright は native drag simulation を持たない (`existingTests.md §4-4`)。dispatchEvent の順序と scope に注意。

### S-UPLOAD-04: `フォルダを選択` で subfolder 込みの upload

- **ペルソナ**: P-USER
- **前提**: tmpdir に 2 段構造 (`root/sub/file.txt`) を作る (`makeMediumBinaryFile` を folder 経由で拡張したい場合は helper 追加)
- **手順**:
  1. dropdown → `フォルダを選択` → `pickFolderMenuInput(page).setInputFiles(dirPath)`
  2. `.upcard` の該当 row 群が `.tag.ok` `完了`
  3. root に戻り folder row → クリックで sub 階層 → file 行可視
- **期待**:
  - upload 完了後、root に新規 folder row
  - folder に入ると sub 階層と file 行

### S-UPLOAD-05: upload row の「キャンセル」で running upload を停止

- **ペルソナ**: P-USER
- **前提**: `makeMediumBinaryFile(10)` で 10 MiB (multipart 経路確定)、`delayUploadPart(page, { delayMs: 3000 })` で各 UploadPart を 3s 遅延させ、cancel button を押す時間を確保する (localhost の 10 MiB は素で 1s 未満で完走してしまうため)
- **手順**:
  1. upload 開始 (`pickFileMenuInput`)
  2. row の `.uact` に `キャンセル` button が出た瞬間に click
- **期待**:
  - `?uploadId=...` DELETE (AbortMultipartUpload) が飛ぶ (method DELETE 判定)
  - 該当 `.urow` が upcard から消える (`cancel()` は running.abort() 完了後に removeOne(id) を呼ぶため、state=failed error=cancelled は transient で UI には残らない。scenarios v3 で明記)
  - 一覧に file 行は増えない
- **備考**: 個別 cancel は「押した瞬間に row を消す」振舞い。detail text `キャンセル済み` は `cancelAll()` (S-UPLOAD-06) 経由でしか残らないが、そちらも filter で drop されるため実運用では見えない。error="cancelled" は code path として残しているが UI 上には現れないことを明記した。

### S-UPLOAD-06: `すべてキャンセル` で全 active upload を停止

- **ペルソナ**: P-USER
- **前提**: `delayUploadPart(page, { delayMs: 5000 })` で UploadPart を遅延し、2 本の 10 MiB upload が同時に upcard に並ぶ時間を確保する
- **手順**:
  1. 中サイズ (10 MiB) の upload を 2 本連続で開始
  2. upcard に 2 row (running + queued) が並ぶまで待つ (`MAX_CONCURRENT=1` 前提で片方は `.tag.neutral` `待機中`)
  3. `.upcard .uph` の `すべてキャンセル` を押す
- **期待**:
  - `cancelAll()` は running を state=failed error=cancelled にした直後 setTransfers で uploading/done 以外を drop する。結果として upcard から該当 `.urow` はすべて消える
  - 一覧に file 行は増えない
- **備考**: 期待は「少なくとも 1 本が `待機中`」に緩め、`MAX_CONCURRENT` が定数変更で壊れないようにする。「upcard から消える」は暗黙に「.tag.run が 0 件」を含む。

### E-UPLOAD-01: 同名 conflict → スキップ (`スキップ`)

- **ペルソナ**: P-USER
- **手順**:
  1. `dup-${hex}.txt` を upload (完了)
  2. 同名の別内容 file を upload 開始
  3. `.urow` の state tag `.tag.warn` `衝突` を確認
  4. `.uact` の `スキップ` を押す
- **期待**:
  - `.tag.warn` `衝突` 可視、3 button (`上書き` / `別名で保存` / `スキップ`) 可視
  - `スキップ` 押下後、該当 row が消え、`page.waitForResponse` の `PutObject` 発火が 1 回だけ (2 回目の PUT は飛ばない、method + path の exact match で判定)
  - 一覧の file 内容が最初の内容と一致

### E-UPLOAD-02: 同名 conflict → 上書き (`上書き`)

- **ペルソナ**: P-USER
- **手順**:
  1. `dup-${hex}.txt` を upload (完了)
  2. 同名の別内容 file を upload
  3. `.uact` の `上書き` を押す
- **期待**:
  - upload 完了後、GetObject (row menu → ダウンロード) で取得すると 2 回目の内容
  - Content-Length と ETag が 2 回目 upload のものに変わっている (Content-Length の byte 一致で確認、ETag は変わることだけ)

### E-UPLOAD-03: 同名 conflict → 別名で保存 (`別名で保存`)

- **ペルソナ**: P-USER
- **手順**:
  1. `dup-${hex}.txt` を upload (完了)
  2. 同名の別内容 file を upload
  3. `.uact` の `別名で保存` を押す
- **期待**:
  - upload 完了後、一覧に 2 file 存在
  - 元 file は最初の内容、別名 file (suggested name、unit の `suggestSaveAsName` 仕様通り) は 2 回目の内容
  - 別名 file の名前が `.txt` 拡張子を保持し、`(1)` などの suffix を含む

### E-UPLOAD-04: 失敗した upload の `再試行` button (small file 経路)

- **ペルソナ**: P-USER
- **前提**: `stallPutObject(page, { failCount: 1, bucket, key })` で small file の PutObject の最初の 1 回を 500 で fulfill。**`stallUploadPart` は multipart 経路 (10 MB 以上) のみに効くため small file には使えない。別 helper を用意する**
- **手順**:
  1. small file (~2 KiB) の upload 開始
  2. `.tag.fail` `失敗` を待つ
  3. `page.unroute` で intercept 解除
  4. `.uact` の `再試行` (kind=`po`) を押す (**`再開` ではなく `再試行`** — uploadId が確立していない small file 経路の判定は `upload-card.tsx:143-144` の `retryLabel = t.uploadId !== undefined ? "再開" : "再試行"`)
- **期待**:
  - button text が `再試行`
  - 押下後 upload が再走し `完了`

---

## RESUME Domain

### S-RESUME-01: 同一セッションで UploadPart stall → 再開 → byte 一致

- **ペルソナ**: P-USER
- **前提**: `makeMediumBinaryFile(32)` で 32 MiB (part boundary 4 本)、`stallUploadPart(page, { failCount: 1 })` で最初の UploadPart レスポンスを `route.abort("failed")` に落とす
- **手順**:
  1. `pickFileMenuInput(page).setInputFiles(sourcePath)`
  2. `.tag.fail` `失敗` and `.uact .btn` の text `再開` を待つ (uploadId が確立している multipart 経路)
  3. `stallUploadPart` の route を `unroute` で解除
  4. `再開` を押す
  5. `expectUploadDone`
  6. row menu → ダウンロード → byte 一致
- **期待**: `readFileSync(download.path()).equals(originalBuffer)`
- **備考**: `setOffline` に頼らず、UploadPart を `page.route` で確実に落とすことで race を排除 (`existingTests.md §5-1`)。

### S-RESUME-02: 別 context で再ログイン後の resume — pending-uploads card から復元

- **ペルソナ**: P-USER (2 context 使用、順次)
- **手順**:
  1. context 1 で `stallUploadPart` を仕込み、32 MiB upload 開始 → `.tag.fail` `失敗` まで
  2. `await context1.close()`
  3. `const context2 = await browser.newContext({ storageState: ".auth/user.storage.json" })`; sessionStorage snapshot を addInitScript で注入
  4. context 2 の page で `/` を開き、`[data-testid="pending-uploads"]` 可視待ち
  5. card 内 row の `再開` button を押す → hidden file picker (`pickPendingResumeInput`) に同一 sourcePath を `setInputFiles`
  6. `expectUploadDone`
- **期待**:
  - `[data-testid="pending-uploads"]` の row 数 >= 1、row 内 filename が upload 中だった key
  - 再開後、byte 一致
- **備考**: 「認証セッションを取り直しても再開できる」(`requirements.md`) の UI 層担保。ListMultipartUploads が SPA 起動時に走る (`browse-page.tsx:175-180`)。

### S-RESUME-03: 同 context で reload → pending-uploads card から復元

- **ペルソナ**: P-USER
- **前提**: 同一 context (context.close しない)
- **手順**:
  1. `stallUploadPart` 仕込み、32 MiB upload 開始 → `.tag.fail` `失敗` まで
  2. route を unroute
  3. `page.reload()`
  4. `[data-testid="pending-uploads"]` 可視待ち
  5. row `再開` → `pickPendingResumeInput` に同一 sourcePath
  6. `expectUploadDone`
- **期待**:
  - reload 後にも pending-uploads card が復元 (server-side ListMultipartUploads による復元、client-side transient state に依存しない)
  - 再開後 byte 一致
- **備考**: S-RESUME-01 (同 session, uploadId 保持) と S-RESUME-02 (別 context, storageState restore) の中間で、実運用で最も踏まれる経路。

### E-RESUME-01: 別内容の同一サイズ file で再開 → mismatch reject

- **ペルソナ**: P-USER
- **前提**: `preparePendingUpload(page, { key, sizeMiB: 32, uploadedParts: [1, 2], seed: 0x44 })` で SDK 直で multipart upload を作り parts 1-2 を実 upload 済 (verifyCompletedParts が ETag mismatch を検知するには最低 1 part 必要。stallUploadPart 経由だと SDK retry で completed parts が非決定的になるため直接 SDK を使う)
- **手順**:
  1. `page.goto(scopeBrowseUrl())` で pending card を表示させる
  2. row の `再開` を押す → `pickPendingResumeInput` に **中身違い / 同一サイズ file** を setInputFiles
- **期待**:
  - `planResume` は size のみ検査するため通過 (成功 flash `再開を開始しました` が出る) → resumePending → runResume が呼ばれ resumeUpload 内の `verifyCompletedParts` が ETag mismatch を検知して `ResumeMismatchError` を投げる
  - 結果、`.upcard .urow` の state=failed、detail text `内容が一致しません` (`upload-card.tsx:86` の `t.error === "content mismatch"` 分岐)
  - CompleteMultipartUpload は飛ばない
- **備考**: scenarios v2 では `[role="alert"]` 経由の flash `再開できません` を期待していたが、planResume は size mismatch のときだけ flash を出す。content mismatch は resumeUpload 内の verify が発火する経路で、UI 上は transfer row の failed state で見える (integration `verify-mismatch.test.ts` が MD5 照合の byte-level を担保、E2E は UI 層のみ)。

### E-RESUME-02: pending upload を「破棄」で消せる

- **ペルソナ**: P-USER
- **手順**:
  1. S-RESUME-03 相当 (pending card 復元まで)
  2. row の `破棄` を押す
- **期待**:
  - `[role="status"]` text `破棄しました`
  - card から該当 row 消失
  - `?uploadId=...` DELETE (AbortMultipartUpload) が飛ぶ

---

## DOWNLOAD Domain

### S-DOWNLOAD-01: row menu の「ダウンロード」で byte 同一取得

- **ペルソナ**: P-USER
- **前提**: `download-${hex}.txt` を upload
- **手順**:
  1. `openRowMenu(page, filename)`
  2. `.rowmenu getByRole("menuitem", { name: "ダウンロード" })` クリック
  3. `page.waitForEvent("download")`
- **期待**:
  - `download.suggestedFilename()` が upload name と一致 (encoding round-trip 済み)
  - `readFileSync(await download.path())` が upload 内容と一致

### S-DOWNLOAD-02: unicode / space / `%` / `?` / `#` を含む key を download

- **ペルソナ**: P-USER
- **前提**: `e2e ${hex} 100% 実測 #test.txt` (すべて特殊文字) を upload
- **手順**:
  1. row menu → ダウンロード
- **期待**:
  - `suggestedFilename` が UTF-8 名前を含む (`Content-Disposition: filename*=UTF-8''<pct>` 経由)
  - byte 一致
- **備考**: 実 UA (Chromium) の filename\* 尊重を E2E で唯一 pin。

---

## PUBLISH Domain

### S-PUBLISH-01: 単一 file を row-inline で公開 → pubpanel 展開 → 公開バッジ

- **ペルソナ**: P-USER
- **前提**: `pub-${hex}.txt` を upload
- **手順**:
  1. row の `.pubbtn` (`公開する`) クリック → ShareModal (`role=dialog`, name `ファイルを公開`) 開く
  2. modal footer の `公開する` primary button 押す
  3. modal の `.flist` に `.tag.ok` `完了` 出現待ち → modal footer が `閉じる` に変わる → 押して閉じる
- **期待**:
  - 一覧の row に `.c-pub .tag.ok` `公開中` badge
  - row 内 `.pubbtn` が `公開を停止` にトグル
  - row を非 interactive エリアクリックで expand → `.pubpanel` に `.linkbar .u` (URL)
- **備考**: 公開は Button + Tag (switch 無し)。ShareModal 経由が唯一の公開経路。

### S-PUBLISH-02: `.pubpanel` の URL が SPA context 内で GET 200

- **ペルソナ**: P-USER
- **手順**:
  1. S-PUBLISH-01 完了後
  2. `.pubpanel .linkbar .u` の text (URL) を取得
  3. `page.request.get(url)` を叩く (SPA context、cookie 込み)
- **期待**:
  - status 200 (公開 URL は cookie 送っても anonymous 判定)
- **備考**: byte 一致検証は S-PUBSERVE-01 (fresh anon context) に譲り、ここは「URL が可視化されて叩ける」ことを pin。

### S-PUBLISH-03: `.pubpanel` の コピー button でクリップボードに URL

- **ペルソナ**: P-USER
- **前提**: `chromium-user` project の `use.permissions = ["clipboard-read", "clipboard-write"]`
- **手順**:
  1. `.pubpanel .linkbar .cp` (text `コピー`) を押す
- **期待**:
  - button text が `コピー済み` に変わる (1600 ms 内)
  - `page.evaluate(() => navigator.clipboard.readText())` が URL と一致
- **備考**: fresh anon context を作る test は permissions が無いが clipboard を使わない、副作用限定。

### S-PUBLISH-04: 公開停止で `公開中` バッジ消失、URL が SPA context 内で 404

- **ペルソナ**: P-USER
- **手順**:
  1. S-PUBLISH-01 の続き (row publish 済)
  2. row の `.pubbtn` (`公開を停止`) 押下 (confirmation なし、即実行)
  3. `.c-pub` から `公開中` 消失待ち
  4. 元 URL を `page.request.get` で再取得
- **期待**:
  - `公開中` badge 非可視、`.pubbtn` が `公開する` に戻る
  - GET が 404
- **備考**: `browse-page.tsx:385-400`。

### S-PUBLISH-05: bulk 公開 (2 件 checkbox 選択 → 公開)

- **ペルソナ**: P-USER
- **前提**: `bulk1-${hex}.txt`, `bulk2-${hex}.txt` を upload
- **手順**:
  1. 各 row の `${name} を選択` checkbox on
  2. `.bulkbar getByRole("button", { name: "公開する" })` → ShareModal (targets=2)
  3. modal `公開する` submit
  4. `.flist` 各行が `完了` に
  5. modal footer が `閉じる` → 押して閉じる
- **期待**:
  - 2 file row に `公開中` badge

### S-PUBLISH-06a: ShareModal で mode 切替 (未発行 → mode swap)

- **ペルソナ**: P-USER
- **前提**: 1 file select、`.pubbtn` から ShareModal(pub) を開く
- **手順**:
  1. tab `期限つき` を選ぶ
- **期待**:
  - modal title `期限つきリンクを発行`
  - `[aria-label="有効期限"]` Segmented 可視 (`15分` / `1時間` / `12時間`、`12時間` が `aria-selected="true"`)
  - `.flist` の rowStates は初期 (発行前)

### S-PUBLISH-06b: ShareModal で mode 切替 (発行済み → mode swap で state リセット)

- **ペルソナ**: P-USER
- **前提**: 2 file select、pub mode で **bulk2 key を URL に含む PutObjectTagging のみ** 500 で fulfill (E-PUBLISH-01 と同じ route 記法) → submit → 1 件成功 + 1 件失敗 の rowStates を作る
- **手順**:
  1. `page.unroute` で intercept 解除 (後段の retry に影響させない)
  2. mode を `期限つき` に切替
- **期待**:
  - `.flist` の rowStates が空 Map にクリアされ、`.tag.ok` `完了` / `.tag.fail` `失敗` badge が全 row から消えている
- **備考**: `share-modal.tsx:68-72` の `resetOnModeChange` の完全リセット挙動を pin。key 絞りで並列発火の非決定性を排除。

### E-PUBLISH-01: 混在失敗 → `失敗した N 件を再試行` (multi target)

- **ペルソナ**: P-USER
- **前提**: 2 file (`bulk1-${hex}`, `bulk2-${hex}`) を upload
- **手順**:
  1. `page.route` で **bulk2 の key を URL に含む PutObjectTagging のみ** 500 で fulfill (key で絞ることで並列発火の順序非決定性を排除):
     ```
     await page.route((url) => url.pathname.includes(encodeURIComponent(bulk2Key)) && url.search.includes("tagging"), (route) => {
       if (route.request().method() === "PUT") return route.fulfill({ status: 500 })
       return route.continue()
     })
     ```
  2. 2 file を bulk 選択 → file list 側の `.bulkbar` `公開する` → ShareModal → `公開する` submit
  3. `.flist` の bulk1 row = `完了`、bulk2 row = `失敗`
  4. modal footer button text が `失敗した1件を再試行` (N が数値であることを substring で確認)
  5. `page.unroute` で intercept 解除
  6. `失敗した1件を再試行` を押す
- **期待**:
  - retry 後 bulk2 row = `完了`
  - modal 閉じた後、bulk1 & bulk2 両方に `公開中` badge
- **備考**: `share-modal.tsx:250-269` の rowStates 分岐 (busyBatch / retryTargets) を貫通。presign mode でも同 UI (Non-goals にて言及)。bulk2 の key で URL 絞りをかけないと Promise.all 並列発火で「どちらが 1 件目か」が実行毎に変わる。

---

## PRESIGN Domain

**重要**: SPA に「row menu / bulk bar から直接 temp モードを開く trigger は存在しない**」(`browse-page.tsx` grep で `openShare(_, "temp")` の callsite が 0 件)。したがって全 PRESIGN シナリオは **「row `.pubbtn` (`公開する`) → ShareModal(pub) → `[aria-label="共有モード"]` の `期限つき` tab に切替 → `リンクを発行`」の経路** を採用する。`.pubbtn` を押しても submit しない限り公開は発生しない (副作用ゼロ)。

`openPresignModalFromRow(page, filename)` helper を全 test で使う。

### S-PRESIGN-01: row → ShareModal → 期限つき tab → 発行 → badge + panel + byte 一致

- **ペルソナ**: P-USER
- **前提**:
  - `presign01File = uniqueName("presign01")` を `uploadTextFile(page, presign01File, content)` で upload。`content` は 2 KiB 程度、byte 比較用に固定。
  - 対象 row は未公開・未 presign。
- **手順**:
  1. `const modal = await openPresignModalFromRow(page, presign01File)`
     - helper 内: row の `.pubbtn` (`公開する`) → ShareModal (`ファイルを公開`) 開く → `期限つき` tab クリック → title `期限つきリンクを発行` 待ち
  2. modal 内 tab `期限つき` の `aria-selected="true"` を確認
  3. `[aria-label="有効期限"]` の default 選択 tab `12時間` が `aria-selected="true"` を確認
  4. modal footer の primary `getByRole("button", { name: "リンクを発行" })` を押す
  5. modal `.flist` の対象 row `.fmeta` に `.tag.ok` `完了` 出現待ち (最大 10s)
  6. 発行行の下 LinkBar `.linkbar .u` から URL を capture、以下を assertion:
     - `X-Amz-Signature=` を substring 含む
     - Host が `KURA_E2E_S3_ENDPOINT` の host (dev では `localhost:28333`) と一致
  7. URL の隣 `<div>` に text `まで有効` (locale-sensitive な日時 substring)
  8. modal footer が single `閉じる` button に切り替わる → 押して閉じる
  9. 一覧に戻って対象 row の `.c-pub .tag.warn` `期限つき` badge 可視
  10. row を非 interactive エリアクリックで expand → `.presignpanel .linkbar .u` に modal で見た URL と一致
  11. `.presignpanel .pp-top .lbl` に text `期限つきリンク — 約` と `分後に自動で失効します` の substring 両方を含む (中間の分数は timing 依存で範囲チェックしない)
  12. `page.evaluate(() => sessionStorage.getItem("kura.presigned"))` が bucket-scoped entry を含み URL 完全一致
  13. **fresh anon context** (`getAnon`) で URL を GET → status 200 + body byte 一致
- **期待**: 上記 assertion 全て
- **備考**:
  - `expiresAt.toLocaleString()` は locale 依存で system 環境に左右されるため、`まで有効` の literal のみ確認。
  - fresh anon context で叩くのは cookie / storage の非依存を明示するため。実際は host が違うので Cookie は送られないが、明快性のため helper 経由。

### S-PRESIGN-02: TTL の 3 tab 切替と banner text の対応

- **ペルソナ**: P-USER
- **前提**: `openPresignModalFromRow` で temp モードまで到達済、まだ submit していない
- **手順**:
  1. `15分` tab クリック → banner text が `リンクは最長で約15分後に切れます` を含む
  2. `1時間` クリック → banner text が `約1時間後` を含む
  3. `12時間` クリック → banner text が `約12時間後` を含む
- **期待**:
  - 3 tab の `aria-selected` が排他 (1 個 true、他 2 個 false)
  - banner の substring がそれぞれ切り替わる

### E-PRESIGN-01 は削除 (Non-goals §6 で「ShareModal 全体の失敗 → 再試行 UI は E-PUBLISH-01 で担保」に統合)

---

## FILEOPS Domain

### S-FILEOPS-01: rename (file)

- **ペルソナ**: P-USER
- **前提**: `rename-src-${hex}.txt` を upload
- **手順**:
  1. `openRowMenu` → `名前を変更` → modal (`role=dialog`, name `名前を変更`)
  2. `getByLabel("新しい名前")` の初期値が current name であることを確認
  3. `rename-dst-${hex}.txt` に書き換えて `変更` 押下
- **期待**:
  - modal 閉じ、一覧に `rename-dst-...` の row、`rename-src-...` は消失
  - `.upcard` に完了 row 出て `expectUploadRowAutoDismissed`

### S-FILEOPS-02: rename (folder)

- **ペルソナ**: P-USER
- **前提**: `createFolderViaSdk("foldertest-src")`
- **手順**:
  1. folder row kebab → `名前を変更` → modal `フォルダ名を変更`
  2. `getByLabel("新しい名前")` に `foldertest-dst-${hex}` 入力 → `変更`
- **期待**:
  - `foldertest-src-...` 消え `foldertest-dst-...` 可視
  - `.upcard` に完了

### S-FILEOPS-03: move (file) — FolderPicker 経由

- **ペルソナ**: P-USER
- **前提**: file 1 と `dst-${hex}` folder を用意
- **手順**:
  1. row kebab → `移動` → modal (name partial `を移動`)
  2. `getByRole("button", { name: "選ぶ…" })` → FolderPicker (`移動先のフォルダを選ぶ`)
  3. picker で `dst-${hex}` を選択 → `選択` 押下
  4. 外側 MoveModal で `移動` submit
- **期待**:
  - file row が root から消え、`/_browse/dst-${hex}/` に入ると存在
- **備考**: MoveModal は `open && !pickerOpen` で picker open 中は unmount。

### S-FILEOPS-04: copy (file)

- **ペルソナ**: P-USER
- **手順**:
  1. row kebab → `コピー` → modal (name `コピー`)
  2. `getByLabel("コピー後の名前")` が `<orig> のコピー.txt` (suggestCopyName)
  3. `コピー` submit
- **期待**:
  - 一覧に 2 file (元 + コピー)

### S-FILEOPS-05: delete (single) — confirmation modal + Tab 移動検証

- **ペルソナ**: P-USER
- **手順**:
  1. row kebab → `削除` → modal `ファイルを削除`
  2. `cancel.focus()` で明示的に focus (headless Chromium の tab-active 依存で Modal の auto-focus は unreliable のため、初期 focus 検証は unit `modal.test.tsx` に譲る)
  3. `Tab` → `expect(modal.getByRole("button", { name: "削除" })).toBeFocused()`
  4. `Enter` (or 直接 `削除` を click)
- **期待**:
  - modal 閉じ、一覧から row 消失
- **備考**: Modal open 時の auto-focus は unit で pin 済み。E2E ではキー移動の順序 (キャンセル → 削除 の tab 順) だけを担保する。

### S-FILEOPS-06: delete (multi) — bulk bar 経由

- **ペルソナ**: P-USER
- **前提**: 3 file upload
- **手順**:
  1. 2 file の row checkbox on
  2. `.bulkbar` 内 `b` text `2件を選択中`
  3. `.bulkbar getByRole("button", { name: "削除" })` → modal `ファイルを削除` (body に `2 件のファイルを削除`)
  4. `削除` 押下
- **期待**:
  - 2 row 消失、残り 1 row

### S-FILEOPS-07: folder delete (confirmation あり)

- **ペルソナ**: P-USER
- **前提**: folder + 中に 1 file
- **手順**:
  1. folder row kebab → `削除` (danger menuitem)
  2. modal `フォルダを削除` (body 部分 `フォルダ「<name>」とその中身が...`)
  3. `削除` 押下
- **期待**:
  - folder row 消失、中の file も消失

### S-FILEOPS-08: folder move

- **ペルソナ**: P-USER
- **前提**: `src-${hex}/` folder (中に file 1) と `dst-${hex}/` folder
- **手順**:
  1. `src-${hex}/` の folder row kebab → `移動`
  2. modal (name partial `フォルダ「src-...」を移動`)、picker で `dst-${hex}` 選択
  3. `移動` submit
- **期待**:
  - root から `src-...` 消失
  - `/_browse/dst-.../src-.../` に入ると中の file 存在

### S-FILEOPS-09: new folder (empty folder)

- **ペルソナ**: P-USER
- **手順**:
  1. `＋ 新規フォルダ` → modal `新しいフォルダ`
  2. `getByLabel("フォルダ名")` に `emptydir-${hex}` → `作成`
- **期待**:
  - folder row 1 行増える
  - folder に入ると empty state (`.keep` は非表示)

### S-FILEOPS-10: 公開中 file の rename → 旧 URL 404、新 URL 200

- **ペルソナ**: P-USER
- **前提**: `pub-mv-src-${hex}.txt` を upload + publish
- **手順**:
  1. 旧 row を `expandRow(page, "pub-mv-src-${hex}.txt")` で expand → `.pubpanel` 可視化
  2. `.pubpanel .linkbar .u` から旧 URL を capture (または helper で `publicUrl(publicBase, bucket, key)` を JS 計算 — path 依存を排除)
  3. row kebab → `名前を変更` → `pub-mv-dst-${hex}.txt` に書き換えて `変更`
  4. rename 完了後、新 row (`getRow(page, "pub-mv-dst-${hex}.txt")`) を `expandRow` で expand
  5. `.pubpanel .linkbar .u` から新 URL を capture
  6. `getAnon(旧 URL)` で status
  7. `getAnon(新 URL)` で status + byte 一致
- **期待**:
  - 旧 URL: status 404
  - 新 URL: status 200 + upload 内容と一致
  - 新 row に `.c-pub .tag.ok` `公開中` badge (tag が rename 時に carry over)
- **備考**:
  - `publicUrl(publicBase, bucket, key)` は key を URL に埋める → rename で URL が変わる。requirements の「URL はパスをそのまま用いる (不透明化しない)」の完全担保。
  - `.pubpanel` は `isPub && isExpanded` の 2 条件で render (`browse-page.tsx:928-935`)。publish 直後は展開されていないので expand が必須。
  - kura の rename 実装は CopyObject + Delete。`CopyObjectCommand` の `TaggingDirective="COPY"` 挙動により `kura-public=true` tag は自動 carry over される (`app/lib/s3/objects.ts` 参照)。

### E-FILEOPS-01: name 衝突 (rename)

- **ペルソナ**: P-USER
- **前提**: `dup-a-${hex}.txt` と `dup-b-${hex}.txt` を upload
- **手順**:
  1. `dup-a` の rename modal → input を `dup-b-${hex}.txt` に書き換えて `変更`
- **期待**:
  - modal は閉じず、`.ferr` text `「dup-b-${hex}.txt」は既にあります`

### E-FILEOPS-02: 元の名前と同じで rename 拒否

- **ペルソナ**: P-USER
- **手順**:
  1. rename modal を開き、name を変更せず submit
- **期待**:
  - `.ferr` text `元の名前と同じです`

### E-FILEOPS-03: `/` を含む名前で rename / new folder

- **ペルソナ**: P-USER
- **手順**:
  1. rename modal で `foo/bar.txt` → submit
  2. new folder modal で `foo/bar` → submit
- **期待**:
  - rename: `.ferr` text `名前に「/」は使えません`
  - new folder: `.ferr` text `フォルダ名に「/」は使えません`

### E-FILEOPS-04: folder move で自身の中への移動を拒否 (picker が src / descendant を disabled 表示)

- **ペルソナ**: P-USER
- **前提**: `parent-${hex}/child-${hex}/` の 2 段
- **手順**:
  1. `parent-${hex}/` の move modal → `選ぶ…` → picker (`移動先のフォルダを選ぶ`) を開く
  2. `pickerExpandScopePath(picker)` で e2e/${runId} まで expand
  3. src (parent-${hex}) picker-row の CSS assertion: `opacity: 0.4` / `cursor: not-allowed`
  4. src の caret を展開 → child-${hex} picker-row を可視化
  5. child picker-row の CSS assertion: 同じく disabled 表示
- **期待**:
  - picker 上で src とその descendant はどちらも disabled (click しても setSelected されない)
- **備考**: `folder-move-modal.tsx` の `if (destParent === srcPrefix || destParent.startsWith(srcPrefix)) setError(...)` は defense-in-depth。picker 経由の UI では disabledPrefix で src/descendant の click 自体を無効化しているため、`.ferr` text `自分自身の中には移動できません` は現状の UI 経路では到達不能。E2E は picker の disabled 表示を pin する形で対応。

### E-FILEOPS-05: 空 name で submit → 拒否

- **ペルソナ**: P-USER
- **手順**:
  1. rename modal / new folder modal / copy modal で input を空にして submit
- **期待**:
  - それぞれ `.ferr` text `名前を入力してください` / `フォルダ名を入力してください`

---

## PUBSERVE Domain

この Domain は `chromium-user` project (`pubserve.user.spec.ts`) に置く。理由: fresh anon context で公開 URL を叩く前に P-USER で publish 済 object を setup する必要があり、authenticated project 内で SDK 直叩き + fresh anon context 生成 の 2 段構えが最も直截的。

- **setup** (`beforeAll` per spec file): `s3ClientForE2e(page)` を使い、SDK で publish 済 object を用意 (upload + PutObjectTagging with `kura-public=true`)。keys は `uniqueName("pubserve-01")` 等で `e2e/${runId}/` scope に置く。
- **assertion** (per test): `const anon = await browser.newContext({ storageState: undefined }); await anon.request.get(url)` で fresh anon context 経由の GET。`afterEach` で `anon.close()`。helper `getAnon(url)` が open + close を wrap。

### S-PUBSERVE-01: 公開 tag 有り = 200 + Accept-Ranges + audit log 実観測

- **ペルソナ**: P-ANON
- **前提**: `beforeAll` で `pubserve-01-${hex}.txt` を upload + publish
- **手順**:
  1. fresh context の `page.request.get(publicUrl)`
  2. `expectAuditLine(needle: encodeURIComponent(key))` で `${KURA_LOG_DIR}/access-<today>.log` を tail (helper が実装可能なら)
- **期待**:
  - status 200、body = upload 内容
  - `Accept-Ranges: bytes` header 存在
  - audit log にキー入りの行が現れる (実 UA hit を pin、`existingTests.md §4-7`)
- **備考**: audit log 読み込みは `KURA_LOG_DIR` の bind mount 到達性に依存。到達不可なら test 内で `test.skip(!fs.existsSync(logDir), "audit log dir not mounted")` で soft skip。CI では通常 skip。

### S-PUBSERVE-02: 公開 tag 無し = 404、公開停止直後 = 404

- **ペルソナ**: P-ANON
- **前提**: publish → unpublish した object
- **手順**:
  1. fresh context GET
- **期待**: status 404
- **備考**: 情報漏洩防止 (private / 存在なし で同一 404)。

### S-PUBSERVE-03: 特殊文字を含む key の公開配信

- **ペルソナ**: P-ANON
- **前提**: `pubserve03-${hex}#test space 100%.txt` を publish
- **手順**:
  1. fresh context で `context.request.get(encodeURIComponent 済 URL)`
- **期待**:
  - status 200 + body 一致
- **備考**: nginx URI レス proxy_pass の再エスケープ (`nginx/kura.conf.template:112-113`)。integration `public-delivery.test.ts` と 論理重複するが「実 UA HTTP client」経路として 1 本残す。

### S-PUBSERVE-04: Range request で 206

- **ペルソナ**: P-ANON
- **前提**: `makeMediumBinaryFile(2)` で 2 MiB binary を publish
- **手順**:
  1. `context.request.get(url, { headers: { Range: "bytes=0-1023" } })`
- **期待**:
  - status 206
  - `Content-Length: 1024`
- **備考**: body byte 一致は integration に譲る。E2E は status + Content-Length のみ。

### E-PUBSERVE-01: 存在しない object = 404

- **ペルソナ**: P-ANON
- **手順**:
  1. `/${username}/never-existed-${hex}.txt` を GET
- **期待**: status 404

---

## FLOW Domain

### S-FLOW-01: login → upload → publish → 未認証で URL 200 → unpublish → 未認証で URL 404 → logout

- **ペルソナ**: P-ANON → P-USER → P-ANON
- **手順** (各 `test.step` で段組):
  1. context 1 fresh で `/` → LoginBox
  2. login → 認証確立
  3. `uniqueName("flow01")` を upload
  4. row `公開する` → ShareModal → `公開する` submit → 完了 → 閉じる
  5. `.pubpanel .linkbar .u` の URL を取得
  6. `browser.newContext({ storageState: undefined })` で fresh anon context 2 を作り、`context2.request.get(url)` → 200
  7. context 1 で row `公開を停止`
  8. context 2 で 同 URL を再 GET → 404
  9. context 1 で UserMenu → ログアウト
  10. context 1 が LoginBox に戻る
- **期待**: 各段の期待は既存 Domain シナリオ通り
- **備考**: end-to-end smoke test。全 Domain の重要 selector を貫通する monolithic な validation。失敗時 diagnose のため各 step で `page.screenshot()` を artifact に (Playwright の `test.step` で自動)。

---

## 6. Non-goals (E2E ではやらない)

以下は他レイヤで担保され、E2E で書くと重複または不安定になる:

- **filename encoding のバイト透過性の網羅** — integration `public-delivery.test.ts` が固定 (`unicode/percent/space/#/?/+/&/=/(1)~!@` 全パターン)。E2E は代表 (S-DOWNLOAD-02, S-PUBSERVE-03) のみ
- **IAM 境界の網羅 (他 bucket 拒否 / admin role / audience / exp)** — integration `iam-boundary.test.ts` が固定。SPA に他 bucket 経路が無い
- **quota reconciler / TTL sweep / multipart sweep / audit rotate の日次挙動** — integration `ops.test.ts` が時間軸込みで固定
- **quota 超過 → PUT 500 → recovery** — integration `quota.test.ts` が実物で担保。UI 側 over-quota banner は unit `browse-page.test.tsx` で
- **multipart resume ロジック本体 (MD5 / partition / abort)** — integration `upload-resume.test.ts` と unit `resume.test.ts` が完全網羅
- **key encoding / bucket 名判定 / presign filename** — unit / PBT
- **i18n resource parity / lang 判定 / config schema** — unit / PBT
- **unsupported username 画面遷移** — unit routing 分岐が担保、staging に `_` 入り username を用意できない
- **initial CreateBucket の 200 応答** — integration `s3-flows.test.ts` が担保。E2E は SPA 起動時の HeadBucket 発火のみ pin (S-AUTH-04)
- **large-file (100 GB) 実測** — 配備時の手動実測 (`docs/operations.md` の「大容量実測の手順」)
- **audit log の日次ローテ / gzip / retention** — integration `ops.test.ts` が UTC 境界含めて固定 (E2E は「実 UA hit が audit log に載る」ことを S-PUBSERVE-01 で 1 件だけ pin)
- **large-file streaming (数十 MB) の download** — integration `public-delivery.test.ts` の Range/streaming と重複度が高い。S-DOWNLOAD-01/02 は small file で完結
- **presign 発行の server-side failure** — presign は client-side SigV4 計算のため server 失敗経路が薄い。ShareModal 全体の失敗 → 再試行 UI は **E-PUBLISH-01** の multi-target シナリオが pub/temp mode 双方共通の UI (`share-modal.tsx:250-269`) を担保
- **over-quota state での UI (banner / upload disable)** — integration `quota.test.ts` + unit `browse-page.test.tsx` 双方が SSOT。E2E での `page.route` 差替えでは実 state を作れず不安定
- **silent renew (automaticSilentRenew) の実 flow 観測** — 実装は refresh_token grant (top-frame `POST /token`、iframe 不使用、`app/lib/auth/oidc.ts:14-16`) で、`AccessTokenTimer` は `UserManager.storeUser()` 契機でのみ再スケジュールされる。sessionStorage 直接書換 → timer 反映 の経路が無いため、E2E で「近接失効 → renew 発火」を deterministic に観測できない。実 upload の 1 時間超セッション継続は配備時の手動 QA (`docs/operations.md` の「大容量実測の手順」) で observe。unit の `use-s3.test.ts` が `signinSilent` coalesce と 120s 閾値の renew ロジックを担保
- **CORS プリフライトの実 UA 観測** — 実 SPA origin から SeaweedFS S3 endpoint への Allow-Origin / Allow-Headers / Expose-Headers のラウンドトリップは、通常フロー (upload / STS) の実成功で暗黙に担保される (preflight で block されれば S3 op 自体が失敗するため)。専用シナリオを起こす価値は薄く、明示的な test は追加しない
- **nginx location 分岐の URL bar 経路** — CONFIG Domain の `page.request.get` で叩いた 4 endpoint (`/healthz`, `/_config.json`, `/_browse/*`, `/_auth/callback`) は同じ nginx location 分岐を通る。`page.goto` 経由の観測を別途追加する価値は薄い

## 7. 実装ノート

### 7.1 spec ファイルの命名

- 各 spec ファイル (`tests/e2e/*.spec.ts` / `*.user.spec.ts`) は Domain 単位で 1 file、`test.describe` 名を Domain 名に、`test` 名を `S-DOMAIN-XX: ...` の書式で ID と 1:1
- P-ANON は `.spec.ts`、P-USER は `.user.spec.ts`
- Domain 内で self-contained (Domain 内 test の順序独立)。TOOLBAR は `describe.configure({ mode: "serial" })` で serial 化するが個別 test も self-contained (`-g` 単発で通る)

### 7.2 `auth.setup.ts` の実装

```
// tests/e2e/auth.setup.ts
import { expect, test as setup } from "@playwright/test"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const STORAGE = "tests/e2e/.auth/user.storage.json"
const SESSION = "tests/e2e/.auth/user.session.json"

setup("authenticate", async ({ page }) => {
  mkdirSync(dirname(STORAGE), { recursive: true })
  await page.goto("/")
  await page.getByRole("button", { name: "DDBJ アカウントでログイン" }).click()
  await page.locator("#username, input[name=username]").waitFor({ state: "visible", timeout: 60_000 })
  await page.locator("#username, input[name=username]").fill(process.env.E2E_USERNAME!)
  await page.locator("#password, input[name=password]").fill(process.env.E2E_PASSWORD!)
  await page.locator("#kc-login, button[name=login]").click()
  await expect(page.locator(".hdr .user")).toBeVisible({ timeout: 30_000 })

  // storage は Playwright API (cookie + localStorage のみ)、sessionStorage は Storage API iteration で snapshot
  await page.context().storageState({ path: STORAGE })
  const snapshot = await page.evaluate(() => {
    const out: Record<string, string> = {}
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)!
      out[k] = sessionStorage.getItem(k)!
    }
    return JSON.stringify(out)
  })
  writeFileSync(SESSION, snapshot)
})
```

### 7.3 `sessionStoragePage` fixture

```
// tests/e2e/fixtures.ts
import { test as base } from "@playwright/test"
import { readFileSync } from "node:fs"

export const test = base.extend({
  page: async ({ page, context }, use) => {
    const snapshot = readFileSync("tests/e2e/.auth/user.session.json", "utf8")
    await context.addInitScript((s) => {
      const data = JSON.parse(s)
      for (const [k, v] of Object.entries(data)) sessionStorage.setItem(k, v as string)
    }, snapshot)
    await use(page)
  },
})
```

### 7.4 `playwright.config.ts` 骨格

```
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  retries: process.env.CI ? 2 : 0,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: process.env.KURA_E2E_BASE_URL ?? "http://localhost:28080",
    trace: "retain-on-failure",  // `use` 内に置く。defineConfig 直下は invalid
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    { name: "chromium-anon", testMatch: /\.spec\.ts$/, testIgnore: [/\.user\.spec\.ts$/, /auth\.setup\.ts$/] },
    {
      name: "chromium-user",
      testMatch: /\.user\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        storageState: "tests/e2e/.auth/user.storage.json",
        permissions: ["clipboard-read", "clipboard-write"],
      },
    },
  ],
})
```

### 7.5 実行タイミング

- 想定所要時間: 全 test で ~15-25 分 (Silent renew test は long-running で 60-90 秒)
- 手動実行前提。CI 対応 (secret 受け渡し、compose 起動、artifact upload) は別 PR で判断
- 失敗時 trace / html report はホスト cwd の `playwright-report/` に残る

## 8. 現行 spec との対応関係

現行 `core-flows.spec.ts` / `upload-resume.spec.ts` は selector が実装と齟齬 (`getByRole("switch")`, `getByRole("button", { name: "発行" })`, `getByLabel("presigned URL")`, `getByText("アップロード完了")` などは実装に存在しない)。**本シナリオ set 実装時に置き換えて廃止する**。既存の観点は次のように吸収:

| 現行 spec | 吸収先 |
|---|---|
| `core-flows.spec.ts` #1 (updown) | S-UPLOAD-01 + S-DOWNLOAD-01 + S-FILEOPS-05 |
| `core-flows.spec.ts` #2 (publish 200/404) | S-PUBLISH-01 + S-PUBLISH-02 + S-PUBLISH-04 + S-PUBSERVE-01 + S-PUBSERVE-02 |
| `core-flows.spec.ts` #3 (encoding) | S-DOWNLOAD-02 + S-PUBSERVE-03 |
| `core-flows.spec.ts` #4 (drag & drop) | S-UPLOAD-03 |
| `core-flows.spec.ts` #5 (presign 200) | S-PRESIGN-01 (完全書き直し、`公開する` から mode 切替 経路) |
| `upload-resume.spec.ts` (offline resume) | S-RESUME-01 (stallUploadPart deterministic) + S-RESUME-02 (別 context) + S-RESUME-03 (同 context reload) |
