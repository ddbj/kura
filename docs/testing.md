# kura テスト・検証仕様

要求仕様は [requirements.md](./requirements.md)、技術仕様は [architecture.md](./architecture.md)、運用仕様は [operations.md](./operations.md) を参照。

## 方針

- テストはバグを探すために書く。境界値・エッジケース・異常系を必ず対象にする
- kura の本体は SeaweedFS と nginx の設定群なので、**設定群そのものを実物に対して自動検証する**ことを主要テストとする
- mock は外部境界のみ。S3（SeaweedFS）は mock せず実物を使う

## 設定群のテスト

`tests/integration/` に実装（vitest）。`npm test` が compose（`env.test`）と JWKS 配信を自動で起動し、終了時に破棄する。テストごとに一意な username（= bucket）を使い、状態を共有しない。

### IAM policy boundary test（主要テスト）

実 SeaweedFS（compose）に対し、自前鍵で署名した JWT で STS を通して一時 credentials を取り、認可境界を自動検証する:

- 自分の bucket の作成（CreateBucket）と read / write / list / tagging が許可されること
- 他人の bucket の read / write / list / tagging / delete が拒否されること
- 他人の bucket 名での新規 bucket 作成が拒否されること
- role 偽装（token が対応しない role の指定）が拒否されること
- 設定に列挙した `sub` だけが admin role を取れ、任意の bucket にアクセスできること
- audience が一致しない token・期限切れ token が STS で拒否されること

### 公開境界 test

nginx + filer の経路で、公開配信の enforcement を自動検証する:

- tag `kura-public=true` がある object は anonymous で download できること
- tag が無い object・tag 値が `true` 以外の object・存在しないパスは、いずれも同じ 404 で区別できないこと
- unpublish（tag 削除）後は即座に 404 に戻ること
- Range リクエスト、数 MB のストリーミング、directory パスの 404
- ファイル名の encoding（space / `%` / `?` / `#` / unicode / 記号）で配信できること

### integration test

実 SeaweedFS に対して主要フローを検証する:

- STS `AssumeRoleWithWebIdentity` -> multipart upload -> download
- 中断した multipart upload を新しい一時 credentials から再開できること（低レベル API と、SPA の resume 実装そのもの（発見 -> MD5 照合 -> 続行 -> 完成、内容が違うファイルの拒否、破棄）の両方）
- in-flight multipart upload の一覧（`ListMultipartUploads`）の形（Prefix フィルタ、Initiated が無いこと、part ETag = MD5）
- publish / unpublish（tagging）の往復
- 一時 credentials による presigned URL（GET / PUT）と、署名なしリクエストの拒否
- quota 超過での write 拒否、超過中の read / delete、削除 + vacuum 後の自動解除
- 運用タスク: default quota reconciler が未設定 bucket に quota を付けること、file TTL sweep が期限超過の object だけを消すこと（TTL 無効時は何もしないこと）、放置 multipart 掃除が猶予内の upload を残すこと、監査ログの日次圧縮・保持期限削除
- 監査ログ: 公開配信の 200 / 404 が日付ファイルに client IP（X-Forwarded-For）・encoded URI 付きで記録され、SPA への request が混入しないこと

## frontend のテスト

- 構成は unit / pbt / e2e の 3 層。vitest + @testing-library/react + msw、@fast-check/vitest、@playwright/test
- vitest は projects 構成: `unit`（jsdom、`tests/unit/`）/ `pbt`（node、`tests/pbt/`）/ `integration`（node、`tests/integration/`。compose を起動する globalSetup を持つ）。`npm run test:unit` は unit + pbt のみを実行し docker を必要としない。`npm test` は全 projects を実行する
- unit テストはコンポーネントを実物の provider（AuthProvider / i18n / react-query）ごと動かす。認証済み状態は oidc-client-ts のストレージ（sessionStorage の `oidc.user:*` キー）へ User を seed して作る（ストレージ = 外部境界）
- PBT（fast-check）の重点対象:
  - key / prefix 構築（`..`、percent-encoding、unicode、空 segment）
  - username の S3 bucket 名適合判定（SeaweedFS の受理集合との一致）
  - filename validation の境界値
  - i18n resources の ja / en パリティ（キー集合一致・空文字禁止・翻訳漏れ検知）
  - 公開バッジのキャッシュ・遅延取得ロジックの不変条件
- E2E（Playwright、`tests/e2e/`）: 4 ユースケース（upload / download / 公開 / presign）を実ブラウザで通す。起動済みの dev compose（nginx 配信）と DDBJ staging Keycloak を使い、staging の専用テストユーザーでログインする（資格情報は git 管理外の `.env` の `E2E_USERNAME` / `E2E_PASSWORD`）。`npm run test:e2e` で実行する。staging へのネットワーク到達が必要なため `npm test` には含めない

## mock の境界

- mock してよいのは外部境界のみ。内部実装は mock しない
- Keycloak: 自前鍵で署名した JWT + ローカル JWKS 配信で代替する（SeaweedFS の OIDC provider に食わせる）。実 Keycloak をテストに使うのは E2E のみ
- S3 / filer / nginx: mock せず実物（compose）を使う
- frontend の unit test での HTTP 境界は msw で mock する
- テスト間で状態を共有しない。実行順序に依存しない
