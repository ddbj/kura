# kura

kura は、DDBJ account で認証したユーザーが、自分専用の領域に大容量ファイル（100 GB クラス）を置いて読み書きできるストレージ基盤である。ブラウザ（同梱の SPA）からも、CLI（aws cli 等の S3 client）からも、ユーザーが権限を委譲した外部サービスからも、同じ領域に同じ権限でアクセスできる。オンプレミス環境に設置し、BSI のサービスとして提供する。

kura の実態は SeaweedFS（S3 + STS + IAM）の設定群であり、独自の API server は持たない。ファイルの byte は client と S3 の間で直接転送され、kura のコードを通らない。同梱の SPA は S3 API を直接叩く client の reference 実装で、その静的ビルドを配る server が 1 つ付属する。

できるのは「認証付きの upload」「認証付きの download・一覧・削除」「短期の受け渡しのための presigned URL 発行」の 3 つだけである。認証を持たない第三者へファイルを配信する機能は持たない（[docs/requirements.md](./docs/requirements.md)）。

## 全体像

```
+-----------+   OIDC (PKCE)    +---------------+
|  Browser  | <--------------> | DDBJ Keycloak |
|   (SPA)   |                  +---------------+
+-----------+
  |      |
  |      +-- access token --> SeaweedFS STS --> temporary credentials
  |
  +--------- S3 API (SigV4) --> SeaweedFS S3
  |
  +--------- static assets ---> SPA delivery server
```

ユーザーは Keycloak で認証し、得た access token を SeaweedFS の STS に渡して一時 credentials を受け取る。以後のファイル操作はすべて、その credentials で署名した S3 API である。ユーザーの領域は bucket そのもので、bucket 名は username に等しい。

## リポジトリの構成

| パス | 内容 |
| --- | --- |
| `app/` | reference SPA（React Router v7 の SPA モード。BFF は無い） |
| `seaweedfs/` | SeaweedFS コンテナの entrypoint。env から s3.json / iam.json / security.toml を生成し、quota の reconcile ループを回す |
| `scripts/` | SPA の配信と日次運用タスク。node が `.ts` を直接実行する |
| `tests/` | unit / PBT / integration / E2E（[tests/README.md](./tests/README.md)） |
| `docs/` | 仕様。下の索引を参照 |
| `compose.yml` | stack 本体（seaweedfs / web / ops の 3 サービス） |
| `compose.podman.yml` | rootless podman 用の overlay |
| `compose.build.yml` | SPA を pin した node の container でビルドする |
| `compose.test.yml` | テスト用の overlay（JWKS 配信を足す） |
| `env.dev` `env.production` `env.test` | 環境ごとの設定値。secret は含まない |

## 開発

dev 環境は DDBJ staging Keycloak を使う。ローカルに Keycloak は立てない。secret とテストユーザーの資格情報は git 管理外の `.env` に置く（何が必要かは [docs/deployment.md](./docs/deployment.md) の「env と secret を用意する」）。

```sh
npm install
npm run build:container                                  # SPA を build/client へビルド
docker compose --env-file env.dev --env-file .env up -d --wait
```

これで UI が `localhost:28080`、S3 API が `localhost:28333` で上がる。SPA を触るときは HMR の効く dev server を使う。

```sh
npm run dev              # http://localhost:8080
```

テストと静的検査:

```sh
npm test                 # unit + PBT + integration（integration は compose を自動起動する）
npm run test:unit        # unit + PBT のみ（docker 不要）
npm run test:e2e         # E2E（起動済みの dev compose が必要）
npm run typecheck
npm run lint
```

デプロイ固有の設定はビルド時に bundle へ焼き込まれるため、環境ごとにその環境の env でビルドする。`npm run build` は必要な env が無いと失敗する（意図した挙動）。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [docs/requirements.md](./docs/requirements.md) | 要求仕様。kura が利用者に約束すること、および扱わないこと |
| [docs/architecture.md](./docs/architecture.md) | 設計。構成、認証と認可、presign の寿命、quota と TTL、SPA の位置づけ、SeaweedFS 由来の制約 |
| [docs/operations.md](./docs/operations.md) | 運用。env と secret、日次運用タスク、quota、TTL、admin 操作、監査ログ、監視 |
| [docs/deployment.md](./docs/deployment.md) | 配備手順。新しい環境に置くとき上から実行する |
| [docs/sp-integration.md](./docs/sp-integration.md) | SP 向け利用ガイド。公開中の kura の接続先、S3 client（aws cli）からの利用、委譲のための Keycloak client 設定 |
| [tests/README.md](./tests/README.md) | テストの層と走らせ方 |

## License

[Apache-2.0](./LICENSE)
