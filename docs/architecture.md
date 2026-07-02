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
- bucket は初回 upload 時に auto-create される。public / private の prefix 分離や marker object は無く、ファイルツリーには本物のファイルだけが存在する
- bucket 名 = username の前提: SeaweedFS の bucket 名検証は `/` `\` NUL と `.` `..` のみ拒否するため、大半の username はそのまま bucket 名にできる。sanitize の要否は未確定（DDBJ username の文字集合と S3 client 側の bucket 名規則を確認して確定し、必要なら規則をここに明記する）

## 認証・認可

フロー:

1. SPA（または CLI）が DDBJ Keycloak で OIDC 認証（Authorization Code + PKCE）。token は client 側が保持する
2. client が access token を SeaweedFS STS `AssumeRoleWithWebIdentity` に渡し、一時 credentials（access key / secret / session token）を得る
3. 以後の S3 API は一時 credentials の SigV4 署名で行う

role:

- `KuraUserRole`（一般ユーザー）: IAM policy は bucket `${jwt:preferred_username}` に閉じる。自分の bucket の read / write / list / tagging / auto-create を許可し、他人の bucket は拒否する。bucket 名位置での policy 変数展開の成立は未確定（実測で確定する。不成立なら配置方式自体を再検討する）
- `KuraAdminRole`（admin）: 全 bucket にアクセス可。kura 側の設定に列挙した Keycloak `sub`（UUID）のユーザーだけが roleMapping / trust policy でこの role を取れる。Keycloak 側に admin 用の claim / mapper は作らない
- trust policy で role の偽装（token が対応しない role の指定）を拒否する

SeaweedFS の設定:

- iam.json: OIDC provider（issuer = DDBJ Keycloak realm、clientId、jwksUri）、roleMapping、`sts.signingKey`（固定値を secret 注入。[operations.md](./operations.md) 参照）
- s3.json: admin (root) identity のみ（運用専用。通常経路では使わない）。anonymous identity は置かない（公開配信は nginx -> filer で完結するため）

## 公開方式（object tag）

公開状態は object 自身の tag `kura-public=true` で表す。

- publish = `PutObjectTagging`、unpublish = `DeleteObjectTagging`。単一 object の metadata 更新なので O(1)・サイズ非依存で、中途半端な状態が生じない。データは一切動かない
- 配信: anonymous からの `GET /<user>/<path>` に対し、nginx が `auth_request` の internal subrequest（filer `/buckets/<user>/<path>` への HEAD）を発行し、`auth_request_set` で response header `X-Amz-Tagging-kura-public` を取得、値が `true` のときだけ同パスを filer から proxy 配信する
- filer は entry の Extended 属性を HTTP response header として返し、S3 tag は Extended に `X-Amz-Tagging-<key>` として格納されるため、素の nginx 機能だけで判定が成立する（njs 不要）
- 非公開と不存在はどちらも 404 に正規化する（存在の秘匿）
- object ACL は使わない（SeaweedFS の実装欠陥のため。「SeaweedFS 由来の制約と設計根拠」参照）。bucket policy による公開もしない（公開のたびに bucket 単位の共有ドキュメントを書き換える設計は肥大・競合するため）

## presign

- SPA / CLI が一時 credentials で SigV4 presigned URL（GET / PUT）を自己生成する。サーバ側に発行 API は無い
- 寿命は STS session の残り時間に cap され、session 自体も元 access token の exp で cap される。実効上限は未確定（実測で確定して本仕様に明記する）

## SP による非対話利用（identity 委譲）

- act-as-user 方式: SP はユーザーの token で STS から一時 credentials を取り、ユーザー本人と同じ権限（自 bucket のみ）で読み書きする。kura 側に SP 専用の実装・権限は無い
- ユーザーが自分の token を SP に渡すことで委譲する。長時間の処理では access token の寿命を超えるため、token の種類は offline token（SP が refresh で access token を得続け、STS を再取得する）を第一候補とする（未確定。実測で確定する）

## quota と TTL の実現

- quota は SeaweedFS native の per-bucket quota（`s3.bucket.quota`）を使う。使用量は collection（= bucket）のメトリクスから取得され、自前の容量カウンタは持たない。超過すると bucket が read-only になり write が 403 で拒否される
- 新規 bucket への quota default の適用手段は未確定（bucket 作成を検知する provisioning か filer 設定での default か。実測で確定する）
- 全ファイル TTL の実現方式は未確定（S3 lifecycle expiration か volume / file TTL か。[requirements.md](./requirements.md) の挙動要件を満たす方式を実測で確定する）

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
- access token lifespan: client レベルの override で kura だけ調整できる。値は未確定（STS session が token exp で cap される制約と、presign / upload の実測を踏まえて確定する）
- realm 全体の設定・既存 client には手を入れない（master realm は全 DDBJ サービスの共有資産）

## frontend（reference SPA）

- 位置づけ: kura の使い方の reference。S3 API + STS を直接叩き、同じ操作は CLI（aws cli / curl）でも可能。frontend が無くても kura は成立する
- React Router v7 の SPA モード（`ssr: false`、SSR なし）。静的ビルドを内側 nginx が配信する。BFF は無い
- auth: react-oidc-context（PKCE、automaticSilentRenew）
- upload: AWS SDK lib-storage の multipart upload。credentials provider が token の silent renew -> STS 再取得を行い、1 時間を超える upload でも credentials を切らさない
- publish / unpublish: `PutObjectTagging` / `DeleteObjectTagging`。公開バッジは表示中 directory の object にだけ `GetObjectTagging` を並列・遅延発行してキャッシュする（list 応答に tag は乗らないため。ページング前提で実用十分）
- filename validation: [requirements.md](./requirements.md) の制約（space / `%`）を upload 前に検証する
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
| per-bucket quota は超過で bucket を read-only にし write を 403 で拒否する | quota 超過時挙動（[requirements.md](./requirements.md)）の実装。自前の容量カウンタは持たない |
| filer は entry の Extended 属性を response header として返す（S3 tag は `X-Amz-Tagging-<key>`） | 公開配信の tag 判定が素の nginx 機能（`auth_request`）で成立する |
| filer API（HTTP / gRPC）には S3 IAM の認可が効かない | filer は内部 network に閉じ、client からは S3 API のみに触れさせる。filer の metadata-only rename（`?mv.from=`）は運用スクリプト専用（[operations.md](./operations.md)） |
