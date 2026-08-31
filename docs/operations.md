# kura 運用仕様

要求仕様は [requirements.md](./requirements.md)、技術仕様は [architecture.md](./architecture.md)、テスト・検証仕様は [testing.md](./testing.md) を参照。

## デプロイ構成

- 稼働ノード: NIG オンプレミスの a012（`172.19.15.12`）
- SeaweedFS 一式・SPA 配信 server・ops（日次運用タスク。「日次運用タスク」参照）を compose で動かす。port は SPA 配信 = 28080、SeaweedFS S3 = 28333。dev は docker、a012 (staging / production) は rootless podman-compose（下記「a012 (rootless podman) の追加要件」）
- 公開 port の bind 先は `KURA_BIND_ADDR`。**default は `127.0.0.1`** で、開発機やテストが意図せず LAN に晒されないようにしてある。配備先では gateway が別ホストから a012 の IP に proxy してくるため loopback では届かず、`env.production` が `0.0.0.0` を明示している。ホスト側で外から届いてよいのはこの 2 port だけで、それ以外（filer / master）は compose の内部 network に閉じている
- 起動:
  - docker (dev): `docker compose --env-file env.dev --env-file .env up -d --wait`
  - a012: `.env` に `env.<環境>` の内容と secrets を merge しておき（podman-compose 1.0.6 は `--env-file` を複数回渡すと最後の 1 つしか読まない）、`podman-compose --env-file .env -f compose.yml -f compose.podman.yml up -d`
- SPA のビルド成果物（`build/client`）は compose up の前に用意する。デプロイ固有の設定は build 時に bundle へ焼き込まれる（[architecture.md](./architecture.md) frontend）ため、**環境ごとにその環境の env でビルドする**。別環境向けの成果物をそのまま持ち込んではならない
- ビルドは patch version まで pin した node の container で行い、ホストの node / npm の version に依存させない。moving tag（`node:24`）は npm の minor 差で optional dependency の解決が変わり、同じ `package-lock.json` でも `npm ci` が失敗する。成果物は image に焼かず、bind mount 経由でホストの `build/client` に置く:
  - docker (dev): `npm run build:container`（`compose.build.yml`。呼び出したユーザーの uid / gid で走らせて成果物をホスト所有のまま残す）
  - a012 (rootless podman): `podman run --rm -v $PWD:/app -w /app --userns=keep-id -e HOME=/tmp docker.io/library/node:24.13.0 sh -c "npm ci --no-audit --no-fund && npm run build"`
- ビルドは compose up の前に行う。stack を動かしたまま再ビルドした場合は SPA 配信のコンテナを再作成する（`docker compose ... up -d --force-recreate web`）。ビルドは `build/` をディレクトリごと作り直すため、起動済みのコンテナは削除済みの inode を bind mount したままになり、SPA への request が全て失敗する
- volume 設定: per-user bucket は bucket ごとに volume（collection）を消費するため、volume growth は 1 本ずつ（entrypoint が生成する master.toml）、volume 数上限は空きディスクからの自動算出（`-volume.max=0`）にしている。volume 1 本のサイズ上限は env `KURA_VOLUME_SIZE_LIMIT_MB`。**SeaweedFS 4.37 は 30000 以上を起動時に弾く**ため設定値は 30000 未満（dev / test 1024、production 29000）。100 GB クラスは複数 volume に分割保存されるので実使用に影響しない
- SeaweedFS のデータディレクトリ（`-dir=/data`）は compose で bind mount 直接（named / anonymous volume は使わない）。rootless podman + Lustre 上では podman が image の初期内容を volume に copy-up する際に発火する `chown 1000:1000` が拒否されるため。filer の LevelDB も `-dir` 配下（`/data/filerldb2`）に作られるので、永続データはこの 1 本の bind mount に収まる
- 前段の DDBJ gateway（`ddbj/service-gateway-conf`）が `kura.ddbj.nig.ac.jp` -> SPA 配信（a012:28080）、`kura-s3.ddbj.nig.ac.jp` -> SeaweedFS S3（a012:28333）へ proxy する
- filer の port（HTTP 8888 / gRPC）は compose の内部 network に閉じ、ホスト外に公開しない

## a012 (rootless podman) の追加要件

a012 は rootless podman-compose で動かす。dev（docker）とは異なる制約が Lustre bind mount 上で発生するため、`compose.podman.yml` overlay と以下の運用ルールで吸収する:

- **Lustre は subuid range (`/etc/subuid` に割り当てられた 222700000+) の uid の read / write / chown を拒否する**。container 内 process の uid が host uid（w3ddbjld = 2227）にマップされるように userns を組む必要がある:
  - seaweedfs: image が uid 1000 で走る -> `userns_mode: "keep-id:uid=1000,gid=1000"`
  - SPA 配信 / ops: node image の default が root なので userns 追加は不要
- 前提の `w3ddbjld` は `/etc/subuid` に `222700000:65536` の割り当て済み。無い host に配備する場合は事前に `usermod --add-subuids 222700000-222700065535 --add-subgids 222700000-222700065535 w3ddbjld` を依頼する
- `KURA_SEAWEEDFS_DATA_DIR` の bind mount 先はホストで先に mkdir + `chmod 0777` する

## SeaweedFS の pin

- デプロイする SeaweedFS は release tag に固定する。現在の pin: `4.37`
- upstream 公式の配布物のみを使う（fork / patch 禁止）
- 更新手順: pin する tag を上げ、[testing.md](./testing.md) の IAM policy boundary test を含む一式が通ることを確認してから反映する

## 環境

| 環境 | Keycloak | SeaweedFS / SPA 配信 / frontend |
| --- | --- | --- |
| dev | DDBJ staging realm | local docker compose |
| staging | DDBJ staging realm | NIG オンプレミス |
| production | DDBJ production realm | NIG オンプレミス（gateway 経由で TLS 終端） |

- 環境差は env のみ: issuer URL、client id、S3 endpoint、ファイル TTL、root credentials、STS signing key、filer JWT signing key
- dev も DDBJ staging realm を使う。ローカルに Keycloak は立てず、この repo に Keycloak のコンテナ・realm 定義を置かない（`kura-dev` client の redirect URI に localhost を登録して対応する）

## secret 管理

secret は env / secret 注入で渡し、repo・image・env の example ファイルに含めない。

- STS signing key: 決定論的な固定鍵（16 byte 以上、無いと SeaweedFS が起動しない）。鍵を差し替えると発行済みの一時 credentials が全失効する（ユーザーは再ログイン + STS 再取得で回復。データへの影響は無い）
- root credentials（s3.json の admin identity）: 運用スクリプト専用。通常経路（ユーザー操作）では使わない
- filer JWT signing key（`KURA_FILER_JWT_KEY`、security.toml の `jwt.filer_signing.key` と `jwt.filer_signing.read.key` の両方に入る）: filer の HTTP read / write と IAM gRPC を Bearer token 必須にするための鍵（[architecture.md](./architecture.md)）。差し替えは container 再作成で反映され、外部への影響は無い（署名は cluster 内で完結する）

## 日次運用タスク

定期実行が必要な運用タスクは compose の中で完結し、ホスト側に cron / systemd timer を置かない。実行間隔は env `KURA_OPS_INTERVAL_SECONDS`（default 86400 = 日次）。失敗した回は次の通常間隔を待たず、5分後（通常間隔がそれより短い場合はそちらに合わせる）に再試行する。

- default quota reconciler: seaweedfs コンテナの entrypoint 内のループ。quota 未設定の bucket に `KURA_QUOTA_DEFAULT_MB`（default 1048576 = 1 TB）を適用する
- ops サービス（compose の `ops`、node 公式 image + `scripts/` 直接実行）が日次で行うもの:
  - 全ファイル TTL の削除（「全ファイル TTL」参照。`KURA_FILE_TTL_DAYS` が空ならスキップ）
  - 放置 multipart upload の掃除: part の最終アップロードから `KURA_MULTIPART_MAX_AGE_DAYS`（default 7）日を超えた未完了 multipart upload を破棄する。中断した upload の再開猶予がこの日数になる。未完了 part は一覧に見えないまま bucket の容量を消費するため、この掃除が容量リークを防ぐ
- 手動で 1 回だけ実行する場合: `docker compose --env-file env.<環境> --env-file .env run --rm ops node /kura/scripts/ops-daily.ts`（`--now=<ISO 8601>` で判定時刻を上書きできる。リカバリ用）

## quota 運用

- default は 1 TB。新規 bucket への適用は reconciler（「日次運用タスク」参照）が行う
- 個別変更: admin が `weed shell` の `s3.bucket.quota -name=<bucket> -op=set -sizeMB=<N>` で bucket（= ユーザー）単位に変更する。weed shell の topology 系コマンドは `lock` を取ってから実行する（lock なしでは黙って no-op する）
- **`-op=disable` は使わない**: 無効化された quota は quota 未設定と外形上区別できず、reconciler が default を再適用してしまう。事実上の無制限にしたい場合は大きな値を set する
- `KURA_QUOTA_DEFAULT_MB` も同じ理由で正の整数のみ許容する。0 や負値は `-op=disable` と同じ「quota 未設定と区別不能」な状態を作るため、seaweedfs コンテナは起動時にこれを検証し、不正な値なら起動を失敗させる
- 超過時は enforcement（S3 server 内蔵、約 1 分周期）が bucket を read-only にし、upload がエラーで拒否される（HTTP 500）。使用量が quota を下回れば自動で解除される
- 解除の反映には遅延がある: 削除された分は volume の vacuum が走るまで使用量に反映されない。即時に解除したい場合は weed shell で `volume.vacuum -collection=<bucket>` -> `s3.bucket.quota.enforce -apply` を実行する

## 監査ログ

- kura のファイル操作はすべて S3 API として `kura-s3.ddbj.nig.ac.jp` を通るため、取得元は DDBJ gateway の access log 1 本である（client IP + method + path + query が記録される）。SeaweedFS 自体は per-request の log を出さない。kura 側のコンテナは監査ログを持たない
- path（bucket = username）で対象ユーザーに帰属させる。制約: admin が他ユーザーの bucket を操作した場合も bucket 所有者に帰属して見える
- 保持期間: 3 年。gateway 側の access log の運用として担保を依頼する（配備チェックリスト参照）
- 取得内容が不足する場合は SeaweedFS の audit log 機構（`-s3.auditLogConfig`、fluentd 形式）による構造化 event 取得を追加する
- 閲覧手段は当面ホスト上での直接参照（閲覧 UI は持たない）

## admin 運用

- admin membership: env `KURA_ADMIN_SUBS` に Keycloak の `sub`（UUID）をカンマ区切りで列挙する。反映は env 変更 + `docker compose up -d`（コンテナ再作成。hot reload は無い）。STS signing key が変わらない限り、発行済みの一時 credentials は再作成をまたいで有効なまま
- admin の操作手段は 2 つ:
  - `KuraAdminRole` で動く privileged な reference SPA（全 bucket にアクセスできる。仕組みは一般ユーザーと同じ STS + S3 API）
  - root credentials による運用スクリプト
- filer の metadata-only rename（`POST <dst>?mv.from=<src>`）は、大容量ファイルの即時 move が必要な場合に運用スクリプトからのみ使う。client に開放しない（filer API には S3 IAM の認可が効かないため）

## 全ファイル TTL

- TTL は env `KURA_FILE_TTL_DAYS`（日数。空 = 無効 = default）で設定する。SPA はこの値をビルド時に取り込み、各ファイルの有効期限表示に使う。したがって TTL の変更は再ビルドと配信 server の再起動を伴う
- 削除は ops サービスの日次タスク（「日次運用タスク」参照）が行う: 作成時刻（= S3 の LastModified。object は不変なので一致する）+ TTL を過ぎた object を全 bucket から削除する（方式の根拠は [architecture.md](./architecture.md)）。削除の粒度は実行間隔（日次）
- 空フォルダは SPA が置く zero-byte marker `.keep`（末尾が `/.keep` または key 全体が `.keep`）で表現する。この marker は年齢に関わらず TTL sweep の対象外で、空フォルダが自己の age で消えることはない

## バックアップ・監視

- データのバックアップは行わない。kura は TTL を前提とした一時的な受け渡し場所であり、データの保全は利用者の責任とする（必要なデータは手元にも保持してもらう）
- 監視は最低限から始める:
  - 死活: `https://kura.ddbj.nig.ac.jp/`（SPA 配信）と `https://kura-s3.ddbj.nig.ac.jp/healthz`（SeaweedFS S3）への HTTP 監視
  - 容量: a012 のディスク使用量（SeaweedFS のデータディレクトリ）。`-volume.max=0` は空きディスクから自動算出するため、ディスク逼迫が新規書き込み失敗として現れる
  - コンテナ: `docker compose ps` の稼働状態（ops サービスの停止は quota default / TTL の停止を意味する）

## 配備チェックリスト（staging / production）

配備時に確認・実施する項目。完了したものから消し込む。

1. Keycloak client: production realm に `kura` client を作成する（public / PKCE S256 / redirect `https://kura.ddbj.nig.ac.jp/*` / web origins `https://kura.ddbj.nig.ac.jp` / dedicated scope に audience mapper / access token lifespan override 43200s。[architecture.md](./architecture.md) の Keycloak client）。当面 production realm が使えない期間は staging realm の `kura-dev` client に production origin を追記して共用する
2. env: `KURA_VOLUME_SIZE_LIMIT_MB` は 30000 未満（SeaweedFS 4.37 が起動時に弾く）。目安 29000。`-volume.max=0` が空きから本数を自動算出するため、slot 数は事実上ディスク空きで決まる。secrets（STS signing key / root credentials / filer JWT key）を新規生成して `.env` に置く。a012 では env.production の内容と secrets を merge した `.env` 1 ファイルにする（podman-compose 1.0.6 の `--env-file` は 1 個しか読まない）
3. ホスト側ディレクトリ: `KURA_SEAWEEDFS_DATA_DIR` をホストの恒久ディレクトリに向ける（a012 は Lustre 上の `~w3ddbjld/kura-prod/data/seaweedfs`）。事前に mkdir + `chmod 0777`
4. gateway の access log の実地確認: `kura-s3` への upload / download / delete が client IP 付きで記録されること、保持 3 年が gateway 側の運用で担保されることを gateway 管理者と確認する
5. SPA 配信の Host 検証: 配信 server は許可した host 名以外の request を拒否する（[architecture.md](./architecture.md) SPA の配信）。gateway が渡す `Host` が許可設定に含まれること、`https://kura.ddbj.nig.ac.jp/` が 200 を返すことを確認する
6. CORS: `KURA_S3_ALLOWED_ORIGINS` は staging / production では SPA 配信 origin を明示する（`*` は test 専用）。CORS は SeaweedFS が応答する（[architecture.md](./architecture.md) CORS）。gateway 側で `Access-Control-*` を付けたり preflight OPTIONS を短絡させたりしないこと（`service-gateway-conf/nginx/conf.d/kura-s3.conf` は `proxy_pass` だけの素通し）。実地確認は preflight `curl -sS -i -X OPTIONS "$KURA_S3_ENDPOINT/$BUCKET/foo" -H "Origin: $SPA_ORIGIN" -H "Access-Control-Request-Method: PUT" -H "Access-Control-Request-Headers: authorization,amz-sdk-invocation-id,amz-sdk-request,content-type,x-amz-content-sha256,x-amz-date,x-amz-security-token,x-amz-user-agent,x-amz-sdk-checksum-algorithm,x-amz-checksum-crc32"` で 200 + `Access-Control-Allow-Headers` に requested headers が verbatim で返り、`Access-Control-Allow-Origin` が `$SPA_ORIGIN` と一致すること
7. 実測（100 GB クラス / 1 時間超）: 下記「大容量実測の手順」
8. E2E: 配備した環境の URL を `KURA_E2E_BASE_URL` に指定して `npm run test:e2e` が green になること（redirect URI に配備先 origin の登録が必要）

## 大容量実測の手順（配備時）

requirements の「100 GB クラス」「1 時間超の upload」「レジューム」を実環境で確認する:

1. 100 GB クラスのファイルを用意する（例: `head -c 100G /dev/urandom > big.bin`。ゼロ埋めは圧縮などで実態と乖離し得るため乱数にする）
2. ブラウザ（SPA）で upload し、完了後にサイズと内容（先頭・末尾数 MB の比較で可）を確認する。所要が 1 時間を超える場合、credentials provider の silent renew -> STS 再取得で途切れないこと（[architecture.md](./architecture.md) frontend）を兼ねて確認できる。回線が速く 1 時間未満で終わる場合はブラウザの DevTools でスループットを絞って 1 時間超を再現する
3. upload 途中でネットワークを切断（DevTools の offline）し、進捗 Toast の「再開」で続きから完了できること、完成ファイルが元と一致することを確認する
4. ブラウザを閉じて開き直し、「再開待ちのアップロード」からファイルを選び直して再開できることを確認する
5. presigned URL を発行して別ブラウザ（未認証）から download し、内容が一致すること。gateway 経由のストリーミングと Range の確認を兼ねる（`curl -r 0-1023` で partial content が返ること）
