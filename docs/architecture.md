# kura 技術仕様

kura の実態は SeaweedFS（S3 + STS + IAM）と nginx の設定群である。独自の API server / BFF は作らない（S3 API の wrapper にしかならないため）。frontend は S3 API を直接叩く client の一例としての reference 実装で、静的ビルドを nginx が配信する。

要求仕様は [requirements.md](./requirements.md)、運用仕様は [operations.md](./operations.md)、テスト・検証仕様は [testing.md](./testing.md) を参照。

## 原則

- ファイルの byte を kura 独自のプロセスに通さない。upload / download は client <-> SeaweedFS S3 の直接転送、公開配信は nginx -> filer の proxy 配信
- S3（SeaweedFS）が SSOT。公開状態を含むすべての状態は S3 側にあり、別の DB を持たない
- SeaweedFS は upstream 公式のみを使う（fork / patch 禁止）。upstream master HEAD で成立する構成に限る（upstream に無い機能・修正に依存しない）
- IAM policy / roleMapping で参照する JWT claim は top-level の scalar のみ（SeaweedFS の policy engine が nested / 配列 claim を扱えないため）

## 全体構成

```
+---------+   OIDC (PKCE)    +---------------+
| Browser | <--------------> | DDBJ Keycloak |
| (SPA)   |                  +---------------+
+---------+
  |  |  |
  |  |  +-- access token -> SeaweedFS STS -> temporary credentials
  |  |
  |  +----- S3 API (upload/list/tagging/delete/presign) -> SeaweedFS S3
  |                                                            ^
  +--- anonymous download -> nginx --(auth_request + proxy)-> filer
       (nginx serves SPA static build too)
```

コンポーネント:

- SeaweedFS: S3 API・STS・IAM・filer。ファイルと公開状態（tag）の SSOT
- nginx（kura 内側）: SPA 静的配信 + 公開配信（tag 判定）
- DDBJ gateway（`ddbj/service-gateway-conf` の gw-nginx。kura repo の外）: TLS 終端・subdomain routing・CORS
- DDBJ Keycloak: 認証（OIDC）。kura 専用の client を持つ
- reference SPA: React SPA。STS と S3 API を直接叩く

## 配置（per-user bucket）

- ユーザーの領域は bucket そのもの。bucket 名 = username（`preferred_username`）
- ファイル `<user>/<path>` の実体は bucket `<user>` 内の object `<path>`（filer path は `/buckets/<user>/<path>`）
- bucket は client（SPA / CLI）が初回 upload の前に作成する（HeadBucket で存在確認し、無ければ CreateBucket。IAM policy により自分の username の bucket だけ作成できる）。ユーザーから見れば初回 upload 時に領域が自動で用意され、事前の申請は無い。CreateBucket の再実行は 409 BucketAlreadyExists を返すため、存在確認は HeadBucket で行う
- public / private の prefix 分離や marker object は無く、ファイルツリーには本物のファイルだけが存在する
- bucket 名 = username は sanitize せずそのまま使う。SeaweedFS は bucket 作成時に S3 の命名規則（3-63 文字、小文字英数と `.` `-` のみ、先頭末尾は英数、`..` 連続・IP 形式・`xn--` 接頭辞・`-s3alias` 接尾辞・`filemeta` を拒否）を強制する。DDBJ account の username 規則（3-24 文字、先頭は小文字英数、`a-z 0-9 _ -`）のうち、`_` を含む・`-` で終わる等の username はこの規則に適合せず、kura を利用できない（単射な変換を認証経路上で表現できないため、変換による救済はしない）

## 認証・認可

フロー:

1. SPA（または CLI）が DDBJ Keycloak で OIDC 認証（Authorization Code + PKCE）。token は client 側が保持する
2. client が access token を SeaweedFS STS `AssumeRoleWithWebIdentity` に渡し、一時 credentials（access key / secret / session token）を得る
3. 以後の S3 API は一時 credentials の SigV4 署名で行う

role:

- `KuraUserRole`（一般ユーザー）: IAM policy は bucket `${jwt:preferred_username}` に閉じる（bucket 名位置での policy 変数展開は成立する）。policy は自分の bucket への `s3:*` を Allow し、bucket 管理系の操作（`s3:PutBucketPolicy` / `s3:PutBucketAcl` / `s3:PutObjectAcl` / CORS / lifecycle / versioning / object lock）を明示 Deny する。`s3:*` の Allow が必要なのは、bucket 作成（CreateBucket）の認可が SeaweedFS 内部で細粒度 action に解決されないため。他人の bucket は read / write / list / tagging / 作成すべて拒否される
- `KuraAdminRole`（admin）: 全 bucket にアクセス可。kura 側の設定に列挙した Keycloak `sub`（UUID）のユーザーだけが roleMapping / trust policy でこの role を取れる。Keycloak 側に admin 用の claim / mapper は作らない
- trust policy で role の偽装（token が対応しない role の指定）を拒否する

SeaweedFS の設定:

- iam.json: OIDC provider（issuer = DDBJ Keycloak realm、clientId、jwksUri）、roleMapping、`sts.signingKey`（固定値を secret 注入。[operations.md](./operations.md) 参照）
- s3.json: admin (root) identity のみ（運用専用。通常経路では使わない）。anonymous identity は置かない（公開配信は nginx -> filer で完結するため）

## 公開方式（object tag）

公開状態は object 自身の tag `kura-public=true` で表す。

- publish = `PutObjectTagging`、unpublish = `DeleteObjectTagging`。単一 object の metadata 更新なので O(1)・サイズ非依存で、中途半端な状態が生じない。データは一切動かない
- 配信: anonymous からの `GET /<user>/<path>` に対し、nginx が `auth_request` の internal subrequest（filer `/buckets/<user>/<path>` への HEAD。`proxy_method HEAD` で body を引き込まない）を発行し、`auth_request_set` で response header `X-Amz-Tagging-kura-public` を取得、値が `true` のときだけ同パスを filer から proxy 配信する
- filer は entry の Extended 属性を HTTP response header として返し（HEAD でも付く）、S3 tag は Extended に `X-Amz-Tagging-<key>` として格納されるため、素の nginx 機能だけで判定が成立する（njs 不要）。実装上の要点: tag 判定の `if` は `auth_request` より前の rewrite phase で評価されるため、配信は named location への internal redirect に分離する。filer への proxy は `rewrite` + URI なし `proxy_pass` で行う（nginx が URI を再エスケープするため、space / `%` 等を含むファイル名が配信できる）
- 非公開と不存在はどちらも 404 に正規化する（存在の秘匿）。subrequest 内で filer の 404 を 403 に変換し（`auth_request` は 404 を 500 として扱うため）、本 request 側で 401 / 403 を 404 に変換する
- object ACL は使わない（SeaweedFS の実装欠陥のため。「SeaweedFS 由来の制約と設計根拠」参照）。bucket policy による公開もしない（公開のたびに bucket 単位の共有ドキュメントを書き換える設計は肥大・競合するため）

## presign

- SPA / CLI が一時 credentials で SigV4 presigned URL（GET / PUT）を自己生成する。サーバ側に発行 API は無い
- 寿命は STS session の残り時間に cap され（session が切れた presign は `X-Amz-Expires` が残っていても 403）、session は min(元 access token の exp 残り, `DurationSeconds`（900-43200s）, `sts.maxSessionLength`) で決まる。access token lifespan は 3600s（kura client の override）なので、presign の実効上限は約 1 時間

## SP による非対話利用（identity 委譲）

- act-as-user 方式: SP はユーザーの token で STS から一時 credentials を取り、ユーザー本人と同じ権限（自 bucket のみ）で読み書きする。kura 側に SP 専用の実装・権限は無い
- ユーザーが自分の token を SP に渡すことで委譲する。長時間の処理では offline token を使う: ユーザーは scope に `offline_access` を付けて認証し、得られた refresh token（Offline 型、期限なし・idle 30 日で失効）を SP に渡す。SP は refresh で access token を得続け、STS を再取得する。client 側の追加設定は不要（`offline_access` は optional scope として利用可能）

## quota と TTL の実現

- quota は SeaweedFS native の per-bucket quota（`s3.bucket.quota`）を使う。使用量は collection（= bucket）のメトリクスから取得され、自前の容量カウンタは持たない。超過すると enforcement（約 1 分周期）が bucket を read-only にし、write がエラー（HTTP 500。filer の 507 が S3 層で generic エラーになる）で拒否される。使用量が quota を下回れば自動で解除される（削除の反映は volume の vacuum 後）
- 新規 bucket への quota default は、quota 未設定の bucket に default を設定する運用スクリプト（reconciler）を定期実行して適用する（[operations.md](./operations.md)）
- 全ファイル TTL は、作成時刻 + TTL を過ぎた object を削除する日次の運用スクリプトで実現する。SeaweedFS の volume TTL は使わない（失効後も一覧に残り、配信がエラーになる断片状態が生じるため）。S3 lifecycle も使わない（bucket ごとのルール適用と worker の運用が必要になる割に、単純な日次削除と結果が変わらないため）

## ドメインと routing

subdomain 分離:

- `kura.ddbj.nig.ac.jp`: 公開配信 + SPA（kura 内側 nginx）
- `kura-s3.ddbj.nig.ac.jp`: S3 API（SeaweedFS S3）。Host は SigV4 の署名対象なので、外向き endpoint と presign 生成時の endpoint を一致させる

二層 nginx:

- 前段 = DDBJ gateway（gw-nginx）: TLS 終端・subdomain routing・CORS を担当
- 後段 = kura 内側 nginx: SPA 静的配信 + 公開配信（tag 判定）
- filer への到達は内側 nginx（内部 network）からのみ。filer を外部に露出しない

root パスの名前空間:

- gateway が `/ga4gh/` を予約 prefix として分岐する（別サービス用。kura は使わない）
- 内側 nginx は `/<user>/<path>` の公開配信を先に試し、既知の SPA asset / route だけ index.html に fallback する。SPA asset・予約 segment が username と衝突しない routing 順序にする

CORS:

- gateway で一元管理する（Allow-Origin = `https://kura.ddbj.nig.ac.jp`、preflight OPTIONS は gateway が 204 応答、`x-amz-security-token` 等の S3 系 header を許可）。SeaweedFS 側の CORS は無効にして二重付与を避ける
- dev（gateway の無い local compose）では local 側（SeaweedFS `-allowedOrigins` または local nginx）で CORS を持つ

## Keycloak client

- client: `kura-dev`（staging realm）/ `kura`（production realm）。public client、Authorization Code + PKCE
- issuer: staging = `https://idp-staging.ddbj.nig.ac.jp/realms/master`、production = `https://idp.ddbj.nig.ac.jp/realms/master`
- client dedicated scope の protocol mapper: audience mapper（access token の `aud` に client id を入れる。SeaweedFS OIDC provider の検証用）
- admin 判定用の claim / mapper は作らない（admin membership は kura 側の設定。「認証・認可」参照）
- access token lifespan: client レベルの override で 3600s に設定する（realm default は 60s。STS session と presign の実効上限がこの値で決まる。1 時間を超える upload は SPA の credentials provider が silent renew と STS 再取得で継続する）
- realm 全体の設定・既存 client には手を入れない（master realm は全 DDBJ サービスの共有資産）

## frontend（reference SPA）

- 位置づけ: kura の使い方の reference。S3 API + STS を直接叩き、同じ操作は CLI（aws cli / curl）でも可能。frontend が無くても kura は成立する
- React Router v7 の SPA モード（`ssr: false`、SSR なし）。静的ビルドを内側 nginx が配信する。BFF は無い
- auth: react-oidc-context（PKCE、automaticSilentRenew）
- 初回利用: HeadBucket で自分の bucket の存在を確認し、無ければ CreateBucket する（「配置」参照）
- upload: AWS SDK lib-storage の multipart upload。credentials provider が token の silent renew -> STS 再取得を行い、1 時間を超える upload でも credentials を切らさない
- publish / unpublish: `PutObjectTagging` / `DeleteObjectTagging`。公開バッジは表示中 directory の object にだけ `GetObjectTagging` を並列・遅延発行してキャッシュする（list 応答に tag は乗らないため。ページング前提で実用十分）
- TTL 有効時は各ファイルの有効期限を一覧に表示する
- design system: db-portal（BSI）の design system を使う。色は BSI 紫（`#6F4392`）
- i18n: ja / en。言語解決は cookie / localStorage ベース
- package manager: npm

## SeaweedFS 由来の制約と設計根拠

| 制約 | 設計への影響 |
| --- | --- |
| PutObjectAcl が subdirectory の object を扱えない。anonymous read が object ACL を見ない | 公開に object ACL を使わず、tag + nginx enforcement にする |
| IAM policy engine は nested claim を扱えず、STS session 経由では配列 claim が文字列に潰れる | policy 変数・roleMapping には top-level scalar claim（`preferred_username`、`sub`）のみ使う |
| STS signing key は決定論的な固定鍵が必須（無いと起動失敗） | 鍵を secret として注入する（[operations.md](./operations.md)） |
| presigned URL の `X-Amz-Expires` 上限は 604800s（7 日）だが、STS session と token exp で cap される | presign は短期用途に限定し、長期共有は public 化で代替する |
| per-bucket quota は超過で bucket を read-only にし write をエラーで拒否する（filer の 507 が S3 層では 500 になる） | quota 超過時挙動（[requirements.md](./requirements.md)）の実装。自前の容量カウンタは持たない |
| 初回 PUT による bucket の auto-create は admin 権限限定で、STS 認証のユーザーには効かない | bucket 作成は client が明示 CreateBucket で行う（policy で自分の bucket 名のみ許可） |
| bucket 作成時に S3 の bucket 命名規則を強制する | bucket 名 = username をそのまま使い、規則に適合しない username は利用不可とする（「配置」参照） |
| 認可エンジンは一部の bucket 操作（CreateBucket 等）を細粒度 action に解決しない | user policy は own bucket への `s3:*` Allow + 管理系 action の明示 Deny で構成する |
| 新規 collection（= bucket）への書き込みは default で volume を 7 本確保し、volume slot を消費する | master 設定で growth を 1 本に抑え、volume 数上限は空きディスクからの自動算出にする（compose / [operations.md](./operations.md)） |
| filer は entry の Extended 属性を response header として返す（S3 tag は `X-Amz-Tagging-<key>`） | 公開配信の tag 判定が素の nginx 機能（`auth_request`）で成立する |
| filer API（HTTP / gRPC）には S3 IAM の認可が効かない | filer は内部 network に閉じ、client からは S3 API のみに触れさせる。filer の metadata-only rename（`?mv.from=`）は運用スクリプト専用（[operations.md](./operations.md)） |
