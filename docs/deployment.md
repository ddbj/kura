# 配備手順

新しい環境に kura を置くときの手順である。上から順に実行すれば配備が完了する。なぜその設定が必要かは [architecture.md](./architecture.md) と [operations.md](./operations.md) にあり、ここでは参照に留める。

配備先ごとに違う値（FQDN、ホストのパス、Keycloak realm）は env ファイルに集める。この文書には実値を書かない。

## 前提

前段に TLS を終端して subdomain routing を行う gateway が必要である。UI 用と S3 API 用に 2 つの FQDN を用意し、それぞれ kura の公開 port（`KURA_HTTP_PORT` / `KURA_S3_PORT`）へ proxy する。gateway は `Access-Control-*` header を付けず、preflight OPTIONS も短絡させずに素通しする（CORS に応答するのは SeaweedFS だけ、という不変条件を壊さないため。[architecture.md](./architecture.md) の「ネットワーク境界」）。

ホスト側には container runtime（docker compose、または rootless podman + podman-compose）と、SeaweedFS のデータを置く恒久ディレクトリが要る。

## 1. Keycloak client を用意する

配備先の realm に kura 用の client を作る。public client、Authorization Code + PKCE（S256）、redirect URI は UI origin の `/*`、web origins は UI origin。dedicated scope に audience mapper を置き、access token lifespan を client レベルで 43200s に override する（根拠は [architecture.md](./architecture.md) の「Keycloak client」）。realm 全体の設定と既存 client には触らない。

## 2. env と secret を用意する

`env.production` を配備先の値に合わせる。少なくとも次を確認する。

- `KURA_OIDC_ISSUER` / `KURA_OIDC_CLIENT_ID` / `KURA_OIDC_JWKS_URI`: 手順 1 の client
- `KURA_S3_ENDPOINT` / `KURA_ALLOWED_HOSTS` / `KURA_S3_ALLOWED_ORIGINS`: 外向きの FQDN。`KURA_S3_ALLOWED_ORIGINS` は SPA の origin を明示する（`*` はテスト専用）
- `KURA_BIND_ADDR`: gateway が別ホストから来るなら `0.0.0.0`。default の `127.0.0.1` では届かない
- `KURA_SEAWEEDFS_DATA_DIR`: 手順 3 のディレクトリ
- `KURA_VOLUME_SIZE_LIMIT_MB`: 30720（= 30 GiB）以下。これを超える値は master が起動時に弾く

secret は新規に生成し、git 管理外の `.env` に置く（用途と差し替えの影響は [operations.md](./operations.md) の「secret 管理」）。

```sh
KURA_STS_SIGNING_KEY=$(openssl rand -base64 32)
KURA_FILER_JWT_KEY=$(openssl rand -base64 32)
KURA_ROOT_ACCESS_KEY=kura-root-$(openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 8)
KURA_ROOT_SECRET_KEY=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 32)
```

admin として扱う Keycloak の `sub`（UUID）があれば `KURA_ADMIN_SUBS` にカンマ区切りで並べる。空のままなら誰も admin role を assume できない。

podman-compose で動かす場合は、`env.production` の内容と secret を merge した `.env` 1 ファイルにする（podman-compose 1.0.6 は `--env-file` を複数回渡しても最後の 1 つしか読まない）。

## 3. ホスト側のディレクトリを用意する

`KURA_SEAWEEDFS_DATA_DIR` が指すディレクトリを作り、`chmod 0777` しておく。SeaweedFS のデータは named volume ではなく bind mount で直接置く（filer の LevelDB も同じディレクトリ配下に作られるので、永続データはこの 1 本に収まる）。

rootless podman で共有ファイルシステム上に置く場合は、container 内の uid をホストの uid にマップする必要がある。`compose.podman.yml` の overlay がそれを担う。ホストユーザーに subuid / subgid の range が割り当てられていることも確認する。

## 4. SPA をビルドする

SPA の静的ビルド（`build/client`）は stack の起動前に用意する。デプロイ固有の設定はビルド時に bundle へ焼き込まれるため、環境ごとにその環境の env でビルドする。別環境向けの成果物を持ち込んではならない（[architecture.md](./architecture.md) の「reference SPA」）。

```sh
KURA_ENV_FILE=env.production npm run build:container
```

ビルドが読む env は `KURA_OIDC_ISSUER` / `KURA_OIDC_CLIENT_ID` / `KURA_S3_ENDPOINT`（必須。欠けるとビルドが失敗する）と `KURA_FILE_TTL_DAYS` / `KURA_QUOTA_DEFAULT_MB`（任意）の 5 つだけで、secret は渡らない。

ビルドは patch version まで pin した node の container で行う。ホストの node を使うと、moving tag と同じく npm の minor 差で optional dependency の解決が変わり、同じ `package-lock.json` でも `npm ci` が失敗しうる。podman-compose の環境では同等の `podman run` に置き換える（`.env` を読み込み、上記 5 つの env を container へ渡して `npm ci && npm run build`）。

## 5. stack を起動する

```sh
docker compose --env-file env.production --env-file .env up -d --wait
```

podman-compose の場合は手順 2 で merge した `.env` と overlay を使う。

```sh
podman-compose --env-file .env -f compose.yml -f compose.podman.yml up -d
```

## 6. 配備後の確認

1. UI の FQDN が 200 を返すこと。配信 server は `KURA_ALLOWED_HOSTS` に無い Host を拒否するので、gateway が渡す Host が含まれていることを併せて確認する
2. S3 の FQDN の `/healthz` が 200 を返すこと
3. CORS の preflight が SeaweedFS まで届き、requested headers が verbatim で返ること

   ```sh
   curl -sS -i -X OPTIONS "$KURA_S3_ENDPOINT/$BUCKET/foo" \
     -H "Origin: $SPA_ORIGIN" \
     -H "Access-Control-Request-Method: PUT" \
     -H "Access-Control-Request-Headers: authorization,amz-sdk-invocation-id,amz-sdk-request,content-type,x-amz-content-sha256,x-amz-date,x-amz-security-token,x-amz-user-agent,x-amz-sdk-checksum-algorithm,x-amz-checksum-crc32"
   ```

   200 が返り、`Access-Control-Allow-Headers` に要求した header がそのまま並び、`Access-Control-Allow-Origin` が SPA origin と一致すること
4. gateway の access log に upload / download / delete が client IP 付きで記録されること。kura の監査はこの log だけが情報源なので、保持期間（3 年）が gateway 側の運用で担保されることを管理者と確認する（[operations.md](./operations.md) の「監査ログ」）

## 7. 配備先での実測

自動テストは dev / test 環境でしか走らない。配備先でしか確かめられない要求（100 GB クラス、1 時間を超える upload、gateway 経由のストリーミング）は、配備のたびに手で確認する。

1. 100 GB クラスのファイルを用意する（例: `head -c 100G /dev/urandom > big.bin`。ゼロ埋めは圧縮などで実態と乖離しうるので乱数にする）
2. ブラウザで upload し、完了後にサイズと内容（先頭・末尾数 MB の比較で足りる）を確認する。所要が 1 時間を超えれば、credentials の自動更新で転送が途切れないことも同時に確認できる。回線が速く 1 時間未満で終わる場合は DevTools でスループットを絞って再現する
3. upload 途中でネットワークを切断し（DevTools の offline）、転送カードの「再開」で続きから完了できること、完成したファイルが元と一致することを確認する
4. ブラウザを閉じて開き直し、「再開待ちのアップロード」からファイルを選び直して再開できることを確認する
5. presigned URL を発行し、別ブラウザ（未認証）から download して内容が一致すること。`curl -r 0-1023` で partial content が返ることも確認する（gateway 経由のストリーミングと Range の確認を兼ねる）
6. 配備した環境の URL を `KURA_E2E_BASE_URL` に指定して E2E を実行し、green になること（[tests/README.md](../tests/README.md)。redirect URI に配備先 origin の登録が要る）

## 更新

SPA を作り直したときは、配信コンテナを再作成する。

```sh
docker compose --env-file env.production --env-file .env up -d --force-recreate web
```

ビルドは `build/` をディレクトリごと作り直すため、起動したままのコンテナは削除済みの inode を掴み続け、SPA への request が全て失敗する。mount を親ディレクトリに移しても回避できない。

SeaweedFS の pin を上げるときは、[architecture.md](./architecture.md) の「SeaweedFS 由来の制約」の各項目を新しい version に対して確かめ、テスト一式が通ることを確認してから反映する。上げてよい上限がある点にも注意する。
