# 配備手順

新しい環境に kura を配備するときの手順である。上から順に実行すれば、配備が完了する。それぞれの設定が必要な理由は [architecture.md](./architecture.md) と [operations.md](./operations.md) にあり、この文書ではリンクだけを示す。

配備先ごとに違う値（FQDN、ホストのパス、Keycloak の realm）は、環境ごとの env ファイル（`env.production` / `env.staging`）にまとめる。この文書には実際の値を書かず、例は production で書く。staging を配備するときは、`env.production` を `env.staging` に置き換えて同じ手順を実行する。

## 前提

kura の前段に、TLS を終端して subdomain で振り分ける gateway が必要である。UI 用と S3 API 用に 2 つの FQDN を用意し、gateway がそれぞれを kura の公開 port（`KURA_HTTP_PORT` / `KURA_S3_PORT`）へ proxy する。gateway は `Access-Control-*` の header を付けず、preflight の OPTIONS にも自分で応答せずに、SeaweedFS まで通す。CORS に応答するのを SeaweedFS だけにするためである（[architecture.md](./architecture.md) の「ネットワーク境界」）。

ホストには、container runtime（docker compose、または rootless podman + podman-compose）と、SeaweedFS のデータを永続的に置くディレクトリが要る。

## 1. Keycloak client を用意する

配備先の realm に、kura 用の client を作る。設定は次のとおりで、理由は [architecture.md](./architecture.md) の「Keycloak client」にある。realm 全体の設定と既存の client は変更しない。

| 場所 | 項目 | 値 |
| --- | --- | --- |
| Settings | Client authentication | OFF（public client） |
| Settings | Standard flow、OAuth 2.0 Device Authorization Grant | ON |
| Settings | Direct access grants、Implicit flow | OFF |
| Settings | Valid redirect URIs | `<UI origin>/auth/callback` |
| Settings | Valid post logout redirect URIs | `<UI origin>` |
| Settings | Web origins | `<UI origin>` |
| Advanced | Proof Key for Code Exchange Code Challenge Method | S256 |
| Advanced | Access Token Lifespan | 5 Minutes |
| Advanced | Client Offline Session Max | 7 Days |
| Advanced | Use refresh tokens | ON |
| Client scopes | Default | `acr`、`basic`、`web-origins`、`<client-id>-dedicated` |
| Client scopes | Optional | `offline_access` |
| `<client-id>-dedicated` の Mappers | Audience | Included Client Audience = `<client-id>`、Add to access token = ON、Add to ID token = OFF |
| `<client-id>-dedicated` の Mappers | User Attribute | User Attribute = `username`、Token Claim Name = `preferred_username`、Claim JSON Type = String、Add to access token = ON |
| `<client-id>-dedicated` の Scope | Full scope allowed | OFF |

設定したら、この client で access token を取得してデコードする（取得の手順は [sp-integration.md](./sp-integration.md) の「1. access token を得る」）。`aud` に client id が、`sub` と `preferred_username` が入っていることと、`email`・`name` が入っていないことを確かめる。

## 2. env と secret を用意する

環境ごとに、repo を別のディレクトリへ clone する。`.env` も、ビルドする image も、環境ごとに違うためである。その環境の env ファイルを配備先の値に合わせ、少なくとも次の変数を確認する。

- `KURA_OIDC_ISSUER` / `KURA_OIDC_CLIENT_ID` / `KURA_OIDC_JWKS_URI`: 手順 1 の client の値
- `KURA_S3_ENDPOINT` / `KURA_ALLOWED_HOSTS`: 外向きの FQDN
- `KURA_S3_ALLOWED_ORIGINS`: 全環境で `*` にする。origin は認可の境界ではないので、origin を絞る必要が無い（[architecture.md](./architecture.md) の「ネットワーク境界」）
- `KURA_UI_ORIGIN`: UI の外向きの origin（`https://<UI の FQDN>`。末尾に `/` を付けない）。robots.txt と sitemap.xml の絶対 URL に使う
- `KURA_NOINDEX`: 検索エンジンに載せない環境（staging）では `true`、載せる環境（production）では空にする（[architecture.md](./architecture.md) の「SPA の配信」）
- `KURA_BIND_ADDR`: gateway が別のホストから接続するなら `0.0.0.0` にする。既定値の `127.0.0.1` のままだと、gateway からの接続が届かない
- `KURA_SEAWEEDFS_DATA_DIR`: 手順 3 で作るディレクトリ
- `KURA_HTTP_PORT` / `KURA_S3_PORT` / `KURA_SEAWEEDFS_DATA_DIR`: 同じホストに複数の環境を配備するときは、この 3 つを環境ごとに違う値にする
- `KURA_VOLUME_SIZE_LIMIT_MB`: 30720（= 30 GiB）以下にする。30720 を超える値を設定すると、SeaweedFS の master が起動時に拒否する
- `KURA_VOLUME_MIN_FREE_SPACE`: 既定値は 1% である。データを大きな共有ファイルシステムに置くなら、割合ではなく容量（例: `100GiB`）で指定する（[operations.md](./operations.md) の「稼働の形」）
- `KURA_LOG_DIR`: rootless podman で動かすときに、コンテナの出力を書くディレクトリの絶対パス（[operations.md](./operations.md) の「コンテナの出力」）
  - `KURA_LOG_DIR` は、`KURA_SEAWEEDFS_DATA_DIR` とは別のディスクにする
  - 同じホストに複数の環境を配備するときは、環境ごとに分ける
  - podman は `~/` を展開しないので、`~/` を使わずに書く

secret は新しく生成し、git 管理外の `.env` に置く（secret の用途と、差し替えたときの影響は [operations.md](./operations.md) の「secret 管理」）。

```sh
KURA_STS_SIGNING_KEY=$(openssl rand -base64 32)
KURA_FILER_JWT_KEY=$(openssl rand -base64 32)
KURA_ROOT_ACCESS_KEY=kura-root-$(openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 8)
KURA_ROOT_SECRET_KEY=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 32)
```

admin として扱う Keycloak の `sub`（UUID）があれば、`KURA_ADMIN_SUBS` にカンマ区切りで並べる。`KURA_ADMIN_SUBS` が空のままなら、誰も admin role（`KuraAdminRole`）を得られない。

podman-compose で動かす場合は、env ファイルの内容と secret を 1 つの `.env` にまとめる。podman-compose 1.0.6 は、`--env-file` を複数回渡しても最後の 1 つしか読まないためである。

compose の project 名は、`compose.yml` の `name`（production の project 名）になる。同じホストに別の環境を配備するときは、以降のすべての compose のコマンドに `-p <その環境の project 名>` を付けて、container・network・image の名前を環境ごとに分ける。

## 3. ホスト側のディレクトリを用意する

`KURA_SEAWEEDFS_DATA_DIR` が指すディレクトリを、コンテナを動かすユーザーで作る。SeaweedFS のデータは、named volume ではなく bind mount で、このディレクトリに直接置く。filer の LevelDB も同じディレクトリの下に作られるので、永続データはこのディレクトリ 1 つに収まる。

rootless podman で動かす場合は、ホストのユーザーに subuid / subgid の range が割り当てられていることを確認する。image の中には root 以外の uid が持つファイルがあり、podman は image を展開するときに subuid を使うためである。kura のコンテナはコンテナ内の root で動くので、データのディレクトリはホストのユーザーの所有のまま読み書きされる（[operations.md](./operations.md) の「稼働の形」）。

rootless podman で動かす場合は、`KURA_LOG_DIR` が指すディレクトリも、最初に起動する前に作る。

## 4. image をビルドする

web と ops の image は、stack を起動する前に作る。image には SPA のビルド結果が入り、デプロイ固有の設定はビルド時に bundle に埋め込まれる。そのため image は、環境ごとにその環境の env でビルドする。別の環境向けにビルドした image を使ってはならない（[architecture.md](./architecture.md) の「reference SPA」「web と ops の image」）。

```sh
docker compose --env-file env.production --env-file .env build --pull
```

podman-compose の場合は、手順 2 でまとめた `.env` と、overlay（`compose.podman.yml`）を使う。

```sh
podman-compose --env-file .env -f compose.yml -f compose.podman.yml build --pull
```

ビルドが読む env は、次の 7 つだけである。compose が 7 つの env を build arg としてビルドに渡し、secret は渡さない。

- 必須（欠けるとビルドが失敗する）: `KURA_OIDC_ISSUER` / `KURA_OIDC_CLIENT_ID` / `KURA_S3_ENDPOINT` / `KURA_UI_ORIGIN`
- 任意: `KURA_FILE_TTL_DAYS` / `KURA_QUOTA_DEFAULT_MB` / `KURA_NOINDEX`

`--pull` を付けると、base image の最新版を取得してから image を作る。

## 5. stack を起動する

```sh
docker compose --env-file env.production --env-file .env up -d --wait
```

podman-compose の場合は、手順 2 でまとめた `.env` と、overlay（`compose.podman.yml`）を使う。

```sh
podman-compose --env-file .env -f compose.yml -f compose.podman.yml up -d
```

## 6. 配備後の確認

1. UI の FQDN が 200 を返すこと。web（SPA の配信 server）は `KURA_ALLOWED_HOSTS` に無い Host を拒否するので、gateway が渡す Host が `KURA_ALLOWED_HOSTS` に含まれていることも確認する
2. S3 の FQDN の `/healthz` が 200 を返すこと
3. CORS の preflight が SeaweedFS まで届き、preflight で要求した header が `Access-Control-Allow-Headers` にそのまま返ること

   ```sh
   curl -sS -i -X OPTIONS "$KURA_S3_ENDPOINT/$BUCKET/foo" \
     -H "Origin: $SPA_ORIGIN" \
     -H "Access-Control-Request-Method: PUT" \
     -H "Access-Control-Request-Headers: authorization,amz-sdk-invocation-id,amz-sdk-request,content-type,x-amz-content-sha256,x-amz-date,x-amz-security-token,x-amz-user-agent,x-amz-sdk-checksum-algorithm,x-amz-checksum-crc32"
   ```

   200 が返り、`Access-Control-Allow-Headers` に要求した header がそのまま並び、`Access-Control-Allow-Origin` が SPA の origin と一致すること
4. UI の FQDN の `/robots.txt` が `text/plain` で返ること。production では `Sitemap:` の行が、`KURA_NOINDEX=true` の環境では `Disallow: /` の行があること
5. gateway の access log に、upload / download / delete が client IP 付きで記録されること。kura の監査に使える記録はこの log だけなので、記録されていることを管理者と確認する（[operations.md](./operations.md) の「監査ログ」）

## 7. 配備先での実測

自動テストは、dev と test の環境でしか自動では実行されない。配備先でしか確かめられない要求（100 GB クラス、1 時間を超える upload、gateway を通したストリーミング）は、配備のたびに手で確認する。

1. 100 GB クラスのファイルを用意する（例: `head -c 100G /dev/urandom > big.bin`）。ゼロで埋めたファイルは、圧縮などによって実際の転送と違う結果になることがあるので、乱数で作る
2. ブラウザでファイルを upload し、完了後にサイズと内容を確認する（内容は先頭と末尾の数 MB の比較で足りる）。upload に 1 時間を超えてかかれば、credentials の自動更新で転送が途切れないことも同時に確認できる。回線が速くて 1 時間未満で終わる場合は、DevTools でスループットを下げて、1 時間を超える upload を再現する
3. upload の途中でネットワークを切断し（DevTools の offline）、転送カードの「再開」で続きから完了できることと、完成したファイルが元のファイルと一致することを確認する
4. ブラウザを閉じて開き直し、「再開待ちのアップロード」からファイルを選び直して再開できることを確認する
5. presigned URL を発行し、別のブラウザ（未認証）から download した内容が一致することを確認する。presigned URL に `curl -r 0-1023` で request し、partial content が返ることも確認する（gateway を通したストリーミングと Range の確認を兼ねる）
6. staging では E2E を実行し、すべて通ることを確認する（[tests/README.md](../tests/README.md)）。production では E2E を実行しない。E2E はテストユーザーの bucket にファイルを作って消すので、実ユーザーのデータを置く環境では実行しない。次の 3 つの env を staging の値にする。E2E のテストユーザー（`E2E_USERNAME` / `E2E_PASSWORD`）には、staging の realm のユーザーを使う
   - `KURA_E2E_BASE_URL`: staging の UI の origin
   - `KURA_E2E_OIDC_ISSUER`: staging の `KURA_OIDC_ISSUER`
   - `KURA_E2E_S3_ENDPOINT`: staging の `KURA_S3_ENDPOINT`

## 更新

次のときは、image を作り直してから web と ops を作り直す。

- SPA・`scripts/`・依存 package を変えたとき
- ビルドが読む env を変えたとき
- base image の更新を取り込むとき

```sh
docker compose --env-file env.production --env-file .env build --pull
docker compose --env-file env.production --env-file .env up -d --force-recreate web ops
```

podman-compose の場合は、同じ 2 つのコマンドを `podman-compose --env-file .env -f compose.yml -f compose.podman.yml` で実行する。

compose のファイルか `.env` を変えたときは、変わった設定を使う service を `up -d --force-recreate <service>` で作り直す。seaweedfs を作り直す間は、S3 API が数秒止まる。STS signing key を変えない限り、発行済みの一時 credentials と presigned URL は、seaweedfs を作り直したあとも使える。

SeaweedFS の pin を上げるときは、次の順に進める。

1. release notes を読む
2. [architecture.md](./architecture.md) の「SeaweedFS 由来の制約」の各項目を、新しい version で確かめる
3. テスト一式が通ることを確認する
4. 新しい pin を反映する
