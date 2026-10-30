# 開発手順

開発機で kura を動かして開発するときの手順である。テストの実行方法は [tests/README.md](../tests/README.md) にある。

## dev 環境を起動する

dev 環境では、DDBJ account の staging realm でログインする。開発機では Keycloak を動かさない。secret とテストユーザーの資格情報は、git 管理外の `.env` に置く。`.env` に置く secret の一覧は [deployment.md](./deployment.md) の「2. env と secret を用意する」に、テストユーザーの資格情報の変数名は [tests/README.md](../tests/README.md) の「E2E」にある。

```sh
npm install
docker compose --env-file env.dev --env-file .env up -d --wait --build
```

compose が起動すると、UI が `localhost:28080` で、S3 API が `localhost:28333` で応答する。

SPA を変更するときは、vite の dev server を起動する。dev server は、変更したコードをブラウザに即時に反映する（HMR）。dev server の SPA は、compose で起動した S3 API を使う。

```sh
npm run dev              # http://localhost:8080
```

## 変更を反映する

SPA か `scripts/` を変更したら、上の `docker compose ... up -d --wait --build` を実行し直して、web と ops の image を作り直す。web と ops の image に、SPA のビルド結果と `scripts/` が入っているためである。

デプロイ固有の設定はビルド時に bundle に埋め込まれるので、image は環境ごとにその環境の env でビルドする（[architecture.md](./architecture.md) の「reference SPA」）。ホストで `npm run build` を実行すると、ビルドが読む必須の env が無いので失敗する。この失敗は意図した動作である。

## 型検査と lint

```sh
npm run typecheck
npm run lint
```
