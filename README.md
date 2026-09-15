# kura

DDBJ account で認証したユーザーが、自分専用の領域に大容量ファイル（100 GB クラス）を置いて読み書きできるストレージ基盤。ブラウザ（同梱の SPA）のほか、CLI（aws cli 等の S3 client）や、ユーザーが権限を委譲した外部サービスからの非対話利用にも対応する。DDBJ / NIG のオンプレミス環境に設置し、BSI のサービスとして提供する。

できるのは「認証付きの upload」「認証付きの download・一覧・削除」「短期の受け渡しのための presigned URL 発行」の 3 つだけで、認証を持たない第三者へファイルを配信する機能は持たない（[docs/requirements.md](./docs/requirements.md)）。

kura の実態は SeaweedFS（S3 + STS + IAM）の設定群であり、独自の API server は持たない。ファイルの byte は client と S3 の間で直接転送される。同梱の SPA は S3 API を直接叩く client の reference 実装で、その静的ビルドを配信する server が 1 つ付属する。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [docs/requirements.md](./docs/requirements.md) | 要求仕様（ユースケース、機能・非機能要件、non-goals） |
| [docs/architecture.md](./docs/architecture.md) | 技術仕様（構成、認証・認可、presign、routing、SPA の配信、frontend） |
| [docs/operations.md](./docs/operations.md) | 運用仕様（デプロイ、ビルド、環境、secret、quota、admin、監査ログ、配備手順） |
| [docs/testing.md](./docs/testing.md) | テスト・検証仕様 |

## 開発

```sh
npm install
npm test                 # 全テスト (unit / pbt / integration。integration は docker compose を自動起動)
npm run test:unit        # frontend の unit + PBT のみ (docker 不要)
npm run test:integration # 設定群のテストのみ (SeaweedFS を env.test で自動起動)
npm run test:e2e         # E2E (起動済みの dev compose + staging Keycloak が必要。docs/testing.md)
npm run typecheck
npm run lint
```

dev 環境（DDBJ staging Keycloak を使う。S3 = localhost:28333、UI = localhost:28080）:

```sh
npm run build:container  # pin した node の container で SPA を build/client へビルド
docker compose --env-file env.dev --env-file .env up -d --wait
npm run dev              # SPA の dev server (http://localhost:8080、HMR あり)
```

デプロイ固有の設定はビルド時に bundle へ焼き込まれるため、環境ごとにその環境の env でビルドする。手順は [docs/operations.md](./docs/operations.md) の「SPA のビルド」。

`.env` は git 管理外の secret（[docs/operations.md](./docs/operations.md) の「secret 管理」）。

## License

[Apache-2.0](./LICENSE)
