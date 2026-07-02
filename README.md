# kura

認証付きで大容量ファイル（100 GB クラス）を upload / download できる file server。DDBJ / NIG のオンプレミス環境に設置し、BSI のサービスとして提供する。

できること:

- 認証されたユーザーが自分の領域にファイルを upload する（ブラウザから、100 GB クラス）
- 認証されたユーザーが自分のファイルを一覧 / download / 削除する
- ファイルを public にする（恒久 URL で誰でも download 可）。公開停止も対称に行える
- presigned URL を発行する（短期のみ）

認証は DDBJ account（Keycloak）による。ブラウザ（同梱の SPA）のほか、CLI（aws cli 等の S3 client）や外部サービスからの非対話利用にも対応する。

## アーキテクチャ

kura の実態は SeaweedFS（S3 + STS + IAM）と nginx の設定群であり、独自の API server は持たない。ファイルの byte は client と S3 の間で直接転送され、公開配信は nginx が object の tag を判定して行う。

## 開発

```sh
npm install
npm test    # SeaweedFS + nginx (docker compose, env.test) を自動起動して設定群のテストを実行
npm run typecheck
npm run lint
```

dev 環境（DDBJ staging Keycloak を使う。S3 = localhost:28333、UI / 公開配信 = localhost:28080）:

```sh
docker compose --env-file env.dev --env-file .env up -d --wait
```

`.env` は git 管理外の secret（[docs/operations.md](./docs/operations.md) の「secret 管理」参照）。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [docs/requirements.md](./docs/requirements.md) | 要求仕様（ユースケース、機能・非機能要件、non-goals） |
| [docs/architecture.md](./docs/architecture.md) | 技術仕様（構成、認証・認可、公開方式、routing、frontend） |
| [docs/operations.md](./docs/operations.md) | 運用仕様（デプロイ、環境、secret、quota、監査ログ） |
| [docs/testing.md](./docs/testing.md) | テスト・検証仕様 |

## License

[Apache-2.0](./LICENSE)
