# kura テスト・検証仕様

要求仕様は [requirements.md](./requirements.md)、技術仕様は [architecture.md](./architecture.md)、運用仕様は [operations.md](./operations.md) を参照。

## 方針

- テストはバグを探すために書く。境界値・エッジケース・異常系を必ず対象にする
- kura の本体は SeaweedFS の設定群なので、**設定群そのものを実物に対して自動検証する**ことを主要テストとする
- mock は外部境界のみ。S3（SeaweedFS）は mock せず実物を使う

## 設定群のテスト

`tests/integration/` に実装（vitest）。`npm test` が compose（`env.test`）と JWKS 配信を自動で起動し、終了時に破棄する。テストごとに一意な username（= bucket）を使い、状態を共有しない。test stack は dev stack と port・データディレクトリの両方を分けてあり（`env.test`）、dev を起動したまま実行できる。両者が同じデータディレクトリを指すと、後から起動した側が filer の leveldb の flock を取れずに起動に失敗する。

### IAM policy boundary test（主要テスト）

実 SeaweedFS（compose）に対し、自前鍵で署名した JWT で STS を通して一時 credentials を取り、認可境界を自動検証する:

- 自分の bucket の作成（CreateBucket）と read / write / list / tagging が許可されること
- 他人の bucket の read / write / list / tagging / delete が拒否されること
- 他人の bucket 名での新規 bucket 作成が拒否されること
- role 偽装（token が対応しない role の指定）が拒否されること
- `KURA_ADMIN_SUBS` に列挙した `sub` だけが `KuraAdminRole` を取れ、任意の bucket にアクセスできること
- audience が一致しない token・期限切れ token が STS で拒否されること
- 認証なし（anonymous）の request が bucket / object のいずれにも到達できないこと
- compose network 上の別コンテナから filer の HTTP API を無認証で読めないこと（filer には S3 の IAM が効かないため、security.toml の鍵が唯一の防壁）

### integration test

実 SeaweedFS に対して主要フローを検証する:

- STS `AssumeRoleWithWebIdentity` -> multipart upload -> download
- 中断した multipart upload を新しい一時 credentials から再開できること（低レベル API と、SPA の resume 実装そのもの（発見 -> MD5 照合 -> 続行 -> 完成、内容が違うファイルの拒否、破棄）の両方）
- in-flight multipart upload の一覧（`ListMultipartUploads`）の形（Prefix フィルタ、Initiated が無いこと、part ETag = MD5）
- 一時 credentials による presigned URL（GET / PUT）と、署名なしリクエストの拒否。STS session の失効後は `X-Amz-Expires` が残っていても 403 になること
- quota 超過での write 拒否、超過中の read / delete、削除 + vacuum 後の自動解除
- 起動時 env 検証: `KURA_QUOTA_DEFAULT_MB` / `KURA_OPS_INTERVAL_SECONDS` が正の整数でなければ seaweedfs コンテナが起動しないこと
- 運用タスク: default quota reconciler が未設定 bucket に quota を付けること、file TTL sweep が期限超過の object だけを消し、空フォルダの `.keep` marker は年齢に関わらず残すこと（TTL 無効時は何もしないこと）、放置 multipart 掃除が猶予内の upload を残すこと

### SPA 配信のテスト

配信 server（`vite preview`）が SPA を配る形を検証する:

- ルート `/` が index.html を 200 で返すこと（compose healthcheck が依存する）
- SPA route の URL 直打ち（`/browse/...`、`/auth/callback?...`）で index.html が返ること
- 存在しないビルド asset が SPA fallback に流れず 404 になること
- ビルドディレクトリの外へ出る path（`..`、その percent-encode 形）が配信されないこと
- 許可していない `Host` header の request が拒否されること
- 配信 server が `Access-Control-*` を付けないこと（CORS に応答するのは SeaweedFS だけ、という不変条件）

## frontend のテスト

- 構成は unit / pbt / e2e の 3 層。vitest + @testing-library/react + msw、@fast-check/vitest、@playwright/test
- vitest は projects 構成: `unit`（jsdom、`tests/unit/`）/ `pbt`（node、`tests/pbt/`）/ `integration`（node、`tests/integration/`。compose を起動する globalSetup を持つ）。`npm run test:unit` は unit + pbt のみを実行し docker を必要としない。`npm test` は全 projects を実行する
- unit テストはコンポーネントを実物の provider（AuthProvider / i18n / react-query）ごと動かす。認証済み状態は oidc-client-ts のストレージ（sessionStorage の `oidc.user:*` キー）へ User を seed して作る（ストレージ = 外部境界）
- UI の文言は必ず i18n resources を経由する。この不変条件は「`app/` 配下のソース（resources を除く）にコメント以外の日本語リテラルが無いこと」を unit テストで検査して守る
- E2E に出せない画面の状態（quota 超過、一覧取得の失敗、領域の初期化の失敗）は unit テストで担保する。実 SeaweedFS でその状態を再現するのは不安定で、E2E は代わりに正常系の導線だけを通す
- Modal の focus 挙動（開いたときの初期 focus、Tab の折り返し、Escape、閉じたあとの focus 復帰）は unit テストで固定する。すべてのモーダルが同じ実装を共有しているため、壊れたときの影響範囲が広い
- PBT（fast-check）の重点対象:
  - key / prefix 構築（`..`、percent-encoding、unicode、空 segment）
  - username の S3 bucket 名適合判定（SeaweedFS の受理集合との一致）
  - filename validation の境界値
  - ビルド時設定（ファイル TTL / quota default）の受理集合
  - i18n resources の ja / en パリティ（キー集合一致・空文字禁止・翻訳漏れ検知）
  - presigned URL の発行履歴（sessionStorage）と失効判定の不変条件
- E2E（Playwright、`tests/e2e/`）: 3 ユースケース（upload / download / presign）を実ブラウザで通す。起動済みの dev compose（SPA 配信 server）と DDBJ staging Keycloak を使い、staging の専用テストユーザーでログインする（資格情報は git 管理外の `.env` の `E2E_USERNAME` / `E2E_PASSWORD`）。`npm run test:e2e` で実行する。staging へのネットワーク到達が必要なため `npm test` には含めない。シナリオの一覧と、各シナリオが E2E でなければならない理由は `tests/e2e/scenarios.md` にある

## mock の境界

- mock してよいのは外部境界のみ。内部実装は mock しない
- Keycloak: 自前鍵で署名した JWT + ローカル JWKS 配信で代替する（SeaweedFS の OIDC provider に食わせる）。実 Keycloak をテストに使うのは E2E のみ
- S3 / filer: mock せず実物（compose）を使う
- frontend の unit test での HTTP 境界は msw で mock する
- テスト間で状態を共有しない。実行順序に依存しない

## 配備先での実測

自動テストは dev / test 環境でしか走らない。配備先でしか確かめられない要求（100 GB クラス、1 時間超の upload、gateway 経由のストリーミング）は配備時に手で確認する（[operations.md](./operations.md) の「配備手順」7）。

1. 100 GB クラスのファイルを用意する（例: `head -c 100G /dev/urandom > big.bin`。ゼロ埋めは圧縮などで実態と乖離し得るため乱数にする）
2. ブラウザ（SPA）で upload し、完了後にサイズと内容（先頭・末尾数 MB の比較で可）を確認する。所要が 1 時間を超える場合、credentials provider の silent renew -> STS 再取得で途切れないこと（[architecture.md](./architecture.md) の「frontend」）を兼ねて確認できる。回線が速く 1 時間未満で終わる場合はブラウザの DevTools でスループットを絞って 1 時間超を再現する
3. upload 途中でネットワークを切断（DevTools の offline）し、転送カードの「再開」で続きから完了できること、完成ファイルが元と一致することを確認する
4. ブラウザを閉じて開き直し、「再開待ちのアップロード」からファイルを選び直して再開できることを確認する
5. presigned URL を発行して別ブラウザ（未認証）から download し、内容が一致すること。gateway 経由のストリーミングと Range の確認を兼ねる（`curl -r 0-1023` で partial content が返ること）
6. 配備した環境の URL を `KURA_E2E_BASE_URL` に指定して `npm run test:e2e` が green になること（redirect URI に配備先 origin の登録が必要）
