# kura

kura は、DDBJ account で認証したユーザーが、自分専用の領域に大容量ファイル（100 GB クラス）を置いて読み書きするためのストレージ基盤である。ユーザーは、ブラウザ（同梱の SPA）、CLI（aws cli などの S3 client）、ユーザーが権限を委譲した外部サービス（SP）のどれからでも、同じ領域に同じ権限でアクセスできる。kura はオンプレミスに設置し、BSI のサービスとして提供する。

kura は SeaweedFS（S3 API・STS・IAM）の設定群であり、独自の API server を持たない。ファイルの byte は client と SeaweedFS の S3 API の間で直接やり取りし、経路上に kura 独自の server を置かない。同梱の SPA は、S3 API を直接呼ぶ client の reference 実装である。kura には、SPA の静的ビルドを配信する server が 1 つ付属する。

kura の機能は次の 3 つだけである。kura は、認証していない第三者にファイルを配信する機能を持たない（[docs/requirements.md](./docs/requirements.md)）。

- 認証したユーザーによる upload
- 認証したユーザーによる download・一覧・削除
- 短期の受け渡しのための presigned URL の発行

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

ユーザーは Keycloak で認証し、受け取った access token を SeaweedFS の STS に渡して、一時 credentials を受け取る。以後のファイル操作は、すべて一時 credentials で署名した S3 API の呼び出しで行う。ユーザーの領域は 1 つの bucket で、bucket 名は DDBJ account の username と同じである。

## リポジトリの構成

| パス | 内容 |
| --- | --- |
| `app/` | reference SPA（React Router v8 の SPA モード）。SPA は S3 API と STS を直接呼び、SPA 専用の API server（BFF）を間に置かない |
| `seaweedfs/` | SeaweedFS コンテナの entrypoint。env から s3.json・iam.json・security.toml を生成し、quota が未設定の bucket に既定の quota を設定する処理を定期的に実行する |
| `scripts/` | SPA を配信する server と、日次運用タスク。node が `.ts` ファイルを直接実行する |
| `tests/` | unit・PBT・integration・E2E のテスト（[tests/README.md](./tests/README.md)） |
| `docs/` | 仕様。下の「ドキュメント」に一覧がある |
| `Dockerfile` | web と ops の image。SPA をビルドする stage と、devDependencies を除く依存 package だけを入れる runtime の stage に分かれる |
| `compose.yml` | stack 本体（seaweedfs・web・ops の 3 サービス） |
| `compose.podman.yml` | rootless podman で配備するときに `compose.yml` と一緒に渡す overlay。コンテナ内の uid とホストの uid の対応（userns）、コンテナの出力をファイルに書く設定、healthcheck の間隔を持つ |
| `compose.test.yml` | テストのときに `compose.yml` と一緒に渡す overlay。テストで Keycloak の代わりに使う JWKS の配信サービスを足す |
| `env.dev` `env.staging` `env.production` `env.test` | 環境ごとの設定値。secret は含まない |

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [docs/requirements.md](./docs/requirements.md) | 要求仕様。kura が利用者に約束することと、kura が扱わないこと |
| [docs/architecture.md](./docs/architecture.md) | 設計。構成、認証と認可、quota と TTL、SPA の配信などが今の形になっている理由と、SeaweedFS 由来の制約 |
| [docs/operations.md](./docs/operations.md) | 運用。env と secret、日次運用タスク、quota、TTL、admin 操作、監査ログ、コンテナの出力、監視 |
| [docs/deployment.md](./docs/deployment.md) | 配備手順。新しい環境に kura を配備するときに、上から順に実行する |
| [docs/development.md](./docs/development.md) | 開発手順。開発機で dev 環境を起動し、型検査と lint を実行する |
| [docs/sp-integration.md](./docs/sp-integration.md) | SP 向けの利用ガイド。公開中の kura の接続先、S3 client（aws cli）からの使い方、ユーザーが SP に権限を委譲するための SP 側の Keycloak client の設定 |
| [tests/README.md](./tests/README.md) | テストの層と実行方法 |

## License

[Apache-2.0](./LICENSE)
