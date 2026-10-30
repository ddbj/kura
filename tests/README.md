# テスト

kura の本体は SeaweedFS の設定群なので、kura の主要なテストは、設定群を実物の SeaweedFS に対して自動で検証する integration テストである。reference SPA と運用スクリプトは、integration テストに加えて、unit・PBT・E2E の 3 種類のテストで検証する。

## 実行方法

```sh
npm test                 # unit + pbt + integration
npm run test:unit        # unit + pbt のみ（docker 不要）
npm run test:integration # integration のみ
npm run test:e2e         # E2E（起動済みの dev compose + staging Keycloak が必要）
```

`npm test` は、test stack（compose（`env.test`）と JWKS の配信サービス）を自動で起動し、終了時に test stack を破棄する。`KURA_TEST_KEEP=1` を渡すと、test stack を破棄せずに残せる。test stack は、dev stack と port とデータディレクトリの両方を分けてあるので、dev stack を起動したまま実行できる。test stack と dev stack が同じデータディレクトリを使うと、後から起動した側が filer の LevelDB の flock を取れずに、起動に失敗する。

vitest は projects 構成で、次の 3 つの project に分かれている。

- `unit`（jsdom）
- `pbt`（node）
- `integration`（node）。compose を起動する globalSetup を持つ

テストはホストで実行する。`npm test` 自身が compose を起動し、integration はホストの公開 port と `docker exec` を使い、E2E は Playwright のブラウザを使うためである。

## 方針

- テストはバグを探すために書く。境界値・エッジケース・異常系を必ず対象にする
- mock してよいのは外部境界だけで、内部の実装は mock しない。S3（SeaweedFS）と filer は mock せず、実物を使う
- テストは、Keycloak の代わりに、テスト用の鍵で署名した JWT と、ローカルの JWKS の配信サービスを使う。SeaweedFS の OIDC provider は、この JWKS で JWT を検証する。実際の Keycloak を使うのは E2E だけである
- frontend の unit テストでは、HTTP の境界を msw で mock する
- テスト間で状態を共有せず、テストの実行順序に依存させない。integration はテストごとに一意な username（= bucket 名）を使う

## integration（設定群のテスト）

`tests/integration/` にある。実物の SeaweedFS（compose）に対して、kura の設定群が意図どおりに効いていることを確認する。

IAM policy boundary（`iam-boundary.test.ts`）は、認可の境界そのものを検証する。テスト用の鍵で署名した JWT で STS から一時 credentials を取り、次のことを確かめる。

- 自分の bucket の作成（CreateBucket）と、read / write / list / tagging が許可されること
- 自分の bucket の設定（policy・ACL・CORS・lifecycle・versioning・Object Lock・暗号化・quota など）を変える操作が拒否されること
- Object Lock を有効にして作った bucket でも、retention と legal hold が拒否されること
- public-read の ACL を付けて置いた object と bucket に、署名の無い request が届かないこと
- 他人の bucket の read / write / list / tagging / delete が拒否されること
- 他人の bucket 名での、新しい bucket の作成が拒否されること
- role の偽装（token に対応しない role の指定）が拒否されること
- `KURA_ADMIN_SUBS` に列挙した `sub` を持つユーザーだけが `KuraAdminRole` を取れ、任意の bucket にアクセスできること
- audience が一致しない token と、期限切れの token が、STS で拒否されること
- 認証の無い（anonymous の）request が、bucket にも object にも届かないこと
- compose network 上の別のコンテナから、filer の HTTP API を認証なしで読めないこと。filer には S3 の IAM が効かないので、filer へのアクセスに認証を求める手段は、security.toml の鍵（filer JWT signing key）だけである

S3 のフローのテストは、ユースケースを実物の SeaweedFS に対して最後まで実行する。

- STS の `AssumeRoleWithWebIdentity` から、multipart upload、download まで
- 中断した multipart upload を、新しい一時 credentials で再開できること。低レベルの API で再開する場合と、SPA の resume 実装そのもので再開する場合の両方を確かめる。SPA の resume 実装では、発見 → MD5 照合 → 続行 → 完成の流れと、内容が違うファイルの拒否と、破棄を確かめる
- 実行中の multipart upload の一覧の形式（Prefix による絞り込み、part の ETag = MD5）
- 一時 credentials で作った presigned URL（GET / PUT）が使えることと、署名の無い request が拒否されること。`X-Amz-Expires` を過ぎると 403 になること
- STS session の長さが、access token の残り時間ではなく `DurationSeconds` で決まること
- presigned URL を受け取った人が、URL の中の session token から secret key を導いて別の request に署名できないこと。session token を Bearer として送っても拒否されること
- quota を超えると write が拒否されること。quota を超えている間も read と delete ができること。削除と vacuum のあとに read-only が自動で解除されること
- 起動時の env の検証: `KURA_QUOTA_DEFAULT_MB` / `KURA_OPS_INTERVAL_SECONDS` が正の整数でなければ、seaweedfs コンテナが起動しないこと
- 運用タスク:
  - quota reconciler が、quota が未設定の bucket に quota を設定すること
  - TTL の削除が期限を過ぎた object だけを消し、空フォルダを表す `.keep` marker は作成からの経過時間に関わらず残すこと。TTL が無効のときは何もしないこと
  - multipart upload の掃除が、猶予の期間内の upload を残すこと
  - Object Lock を有効にして作った bucket で、日次運用タスクが古い version と delete marker を消し、利用者に見えるファイルは残すこと。TTL を過ぎたファイルは、version も delete marker も残らないこと

SPA の配信のテスト（`spa-delivery.test.ts`）は、SPA の配信 server がどう SPA を配るかを検証する。

- `/` が index.html を 200 で返すこと（compose の healthcheck が `/` を使う）
- SPA の route の URL に直接アクセスすると、index.html が返ること
- 存在しないビルド asset には、SPA の fallback で index.html を返さず、404 を返すこと
- ビルドディレクトリの外を指す path（`..` と、`..` を percent-encode した形）を配信しないこと
- 許可していない `Host` header の request を拒否すること
- 配信 server が `Access-Control-*` の header を付けないこと（CORS に応答するのは SeaweedFS だけ、という不変条件）
- 検索エンジンに載せない環境（`env.test` は `KURA_NOINDEX=true`）で、次のとおりになること。robots.txt は `/llms.txt` 以外のクロールを拒否する。`/sitemap.xml` は SPA の fallback で index.html を返さず、404 になる。`/llms.txt` は S3 endpoint を示す。index.html に noindex が付く

検索エンジンに載せる環境の robots.txt などの中身は、unit テストで確かめる。

## unit

`tests/unit/` にある。unit テストは、コンポーネントを実物の provider（AuthProvider・i18n・react-query）ごと動かす。認証済みの状態は、oidc-client-ts のストレージに User を seed して作る（ストレージは外部境界として扱う）。

E2E で再現できない画面の状態（quota の超過、一覧の取得の失敗、領域の初期化の失敗）は、unit テストで確かめる。実物の SeaweedFS でこうした状態を再現すると結果が安定しないので、E2E は正常系の操作の流れだけを確かめる。

UI の文言が必ず i18n resources を経由することも、unit テストで確かめる。unit テストは、`app/` の下のソース（i18n resources を除く）のコメント以外の部分に、日本語のリテラルが無いことを検査する。

モーダルの focus の挙動（開いたときの初期 focus、Tab の折り返し、Escape、閉じたあとの focus の復帰）も、unit テストで確かめる。すべてのモーダルが同じ実装を共有しているので、モーダルの実装が壊れたときの影響の範囲が広い。

## PBT

`tests/pbt/` にある。fast-check で不変条件を検査する。主な対象は次のとおりである。

- key と prefix の組み立て（`..`、percent-encoding、unicode、空の segment）
- username が S3 の bucket 名として使えるかの判定（SeaweedFS が受け付ける名前の集合と一致すること）
- ファイル名の検証の境界値
- ビルド時の設定（ファイルの TTL・quota の既定値・UI の origin）として受け付ける値の集合
- i18n resources の ja と en の対応（キーの集合が一致すること、空文字が無いこと、翻訳漏れが無いこと）
- presigned URL の発行履歴と、失効の判定の不変条件

## E2E

`tests/e2e/` にある。3 つのユースケース（upload・download・presign）を、実際のブラウザで実行する。E2E は、起動済みの dev compose と DDBJ の staging の Keycloak を使い、staging の専用のテストユーザーでログインする。テストユーザーの資格情報は、git 管理外の `.env` の `E2E_USERNAME` / `E2E_PASSWORD` に置く。E2E は staging にネットワークで到達する必要があるので、`npm test` には含めない。

シナリオの一覧と、各シナリオを E2E で確かめなければならない理由は、[e2e/scenarios.md](./e2e/scenarios.md) にある。

配備先でしか確かめられない要求（100 GB クラス、1 時間を超える upload、gateway を通したストリーミング）は、自動テストの対象外である。配備時に手で確認する（[../docs/deployment.md](../docs/deployment.md) の「7. 配備先での実測」）。
