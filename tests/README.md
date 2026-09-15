# テスト

kura の本体は SeaweedFS の設定群なので、設定群そのものを実物に対して自動検証することを主要テストに据えている。reference SPA と運用スクリプトは、その上で unit / PBT / E2E の 3 層で担保する。

## 走らせ方

```sh
npm test                 # unit + pbt + integration
npm run test:unit        # unit + pbt のみ（docker 不要）
npm run test:integration # integration のみ
npm run test:e2e         # E2E（起動済みの dev compose + staging Keycloak が必要）
```

`npm test` は compose（`env.test`）と JWKS 配信を自動で起動し、終了時に破棄する。`KURA_TEST_KEEP=1` を渡すとスタックを残せる。test stack は dev stack と port・データディレクトリの両方を分けてあるので、dev を起動したまま実行できる。両者が同じデータディレクトリを指すと、後から起動した側が filer の LevelDB の flock を取れずに起動に失敗する。

vitest は projects 構成で、`unit`（jsdom）/ `pbt`（node）/ `integration`（node。compose を起動する globalSetup を持つ）に分かれている。

テストはホストで実行する。`npm test` 自身が compose を起動する側であり、integration はホストの公開 port と `docker exec` に、E2E は Playwright のブラウザに依存する。

## 方針

- テストはバグを探すために書く。境界値・エッジケース・異常系を必ず対象にする
- mock してよいのは外部境界だけで、内部実装は mock しない。S3（SeaweedFS）と filer は mock せず実物を使う
- Keycloak は自前鍵で署名した JWT とローカルの JWKS 配信で代替する（SeaweedFS の OIDC provider に食わせる）。実 Keycloak を使うのは E2E だけ
- frontend の unit テストの HTTP 境界は msw で mock する
- テスト間で状態を共有せず、実行順序に依存しない。integration はテストごとに一意な username（= bucket）を使う

## integration — 設定群のテスト

`tests/integration/`。実 SeaweedFS（compose）に対して、kura の設定群が意図どおりに効いていることを確認する。kura の主要テストである。

**IAM policy boundary**（`iam-boundary.test.ts`）は認可境界そのものを検証する。自前鍵で署名した JWT で STS を通して一時 credentials を取り、次を確かめる。

- 自分の bucket の作成（CreateBucket）と read / write / list / tagging が許可されること
- 他人の bucket の read / write / list / tagging / delete が拒否されること
- 他人の bucket 名での新規 bucket 作成が拒否されること
- role 偽装（token が対応しない role の指定）が拒否されること
- `KURA_ADMIN_SUBS` に列挙した `sub` だけが `KuraAdminRole` を取れ、任意の bucket にアクセスできること
- audience が一致しない token・期限切れ token が STS で拒否されること
- 認証なし（anonymous）の request が bucket / object のいずれにも到達できないこと
- compose network 上の別コンテナから filer の HTTP API を無認証で読めないこと。filer には S3 の IAM が効かないので、security.toml の鍵が唯一の防壁になる

**S3 のフロー**は、ユースケースを実物に対して通す。

- STS `AssumeRoleWithWebIdentity` から multipart upload、download まで
- 中断した multipart upload を新しい一時 credentials から再開できること（低レベル API と、SPA の resume 実装そのもの（発見 → MD5 照合 → 続行 → 完成、内容が違うファイルの拒否、破棄）の両方）
- in-flight multipart upload の一覧の形（Prefix フィルタ、`Initiated` が無いこと、part ETag = MD5）
- 一時 credentials による presigned URL（GET / PUT）と、署名なし request の拒否。STS session の失効後は `X-Amz-Expires` が残っていても 403 になること
- quota 超過での write 拒否、超過中の read / delete、削除と vacuum 後の自動解除
- 起動時 env 検証: `KURA_QUOTA_DEFAULT_MB` / `KURA_OPS_INTERVAL_SECONDS` が正の整数でなければ seaweedfs コンテナが起動しないこと
- 運用タスク: quota reconciler が未設定 bucket に quota を付けること、TTL sweep が期限超過の object だけを消し `.keep` marker は年齢に関わらず残すこと（TTL 無効時は何もしないこと）、multipart 掃除が猶予内の upload を残すこと

**SPA 配信**（`spa-delivery.test.ts`）は、配信 server が SPA を配る形を検証する。

- ルート `/` が index.html を 200 で返すこと（compose の healthcheck が依存する）
- SPA route の URL 直打ちで index.html が返ること
- 存在しないビルド asset が SPA fallback に流れず 404 になること
- ビルドディレクトリの外へ出る path（`..` とその percent-encode 形）が配信されないこと
- 許可していない `Host` header の request が拒否されること
- 配信 server が `Access-Control-*` を付けないこと（CORS に応答するのは SeaweedFS だけ、という不変条件）

## unit

`tests/unit/`。コンポーネントは実物の provider（AuthProvider / i18n / react-query）ごと動かす。認証済み状態は oidc-client-ts のストレージへ User を seed して作る（ストレージ = 外部境界）。

E2E に出せない画面の状態（quota 超過、一覧取得の失敗、領域の初期化の失敗）はここで担保する。実 SeaweedFS でその状態を再現するのは不安定なので、E2E は正常系の導線だけを通す。

UI の文言が必ず i18n resources を経由することも unit テストで守る。`app/` 配下のソース（resources を除く）にコメント以外の日本語リテラルが無いことを検査している。

モーダルの focus 挙動（開いたときの初期 focus、Tab の折り返し、Escape、閉じたあとの focus 復帰）も固定してある。すべてのモーダルが同じ実装を共有しているため、壊れたときの影響範囲が広い。

## PBT

`tests/pbt/`。fast-check で不変条件を検査する。重点対象は次のとおり。

- key / prefix の構築（`..`、percent-encoding、unicode、空 segment）
- username の S3 bucket 名適合判定（SeaweedFS の受理集合との一致）
- filename validation の境界値
- ビルド時設定（ファイル TTL / quota の既定値）の受理集合
- i18n resources の ja / en パリティ（キー集合の一致、空文字の禁止、翻訳漏れの検知）
- presigned URL の発行履歴と失効判定の不変条件

## E2E

`tests/e2e/`。3 つのユースケース（upload / download / presign）を実ブラウザで通す。起動済みの dev compose と DDBJ staging Keycloak を使い、staging の専用テストユーザーでログインする。資格情報は git 管理外の `.env` の `E2E_USERNAME` / `E2E_PASSWORD` に置く。staging へのネットワーク到達が必要なため `npm test` には含めない。

シナリオの一覧と、各シナリオが E2E でなければならない理由は [e2e/scenarios.md](./e2e/scenarios.md) にある。

配備先でしか確かめられない要求（100 GB クラス、1 時間を超える upload、gateway 経由のストリーミング）は自動テストの対象外で、配備時に手で確認する（[../docs/deployment.md](../docs/deployment.md) の「配備先での実測」）。
