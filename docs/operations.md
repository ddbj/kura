# kura 運用仕様

要求仕様は [requirements.md](./requirements.md)、技術仕様は [architecture.md](./architecture.md)、テスト・検証仕様は [testing.md](./testing.md) を参照。

## デプロイ構成

- 稼働ノード: NIG オンプレミスの a012（`172.19.15.12`）
- docker compose で SeaweedFS 一式・kura 内側 nginx・ops（日次運用タスク。「日次運用タスク」参照）を動かす。port は内側 nginx = 28080、SeaweedFS S3 = 28333
- 起動は `docker compose --env-file env.<環境> --env-file .env up -d --wait`（`.env` は git 管理外の secret。「secret 管理」参照）
- 内側 nginx は SPA のビルド成果物（`build/client`）をマウントして配信するため、compose up の前に `npm ci && npm run build` を実行する。ビルド成果物は環境非依存（デプロイ固有の設定は nginx が env から `/_config.json` として配信する。[architecture.md](./architecture.md)）
- volume 設定: per-user bucket は bucket ごとに volume（collection）を消費するため、volume growth は 1 本ずつ（entrypoint が生成する master.toml）、volume 数上限は空きディスクからの自動算出（`-volume.max=0`）にしている。volume 1 本のサイズ上限は env `KURA_VOLUME_SIZE_LIMIT_MB`（dev / test は 1024。production の値は配備時に空きディスクと合わせて決める）
- 前段の DDBJ gateway（`ddbj/service-gateway-conf`）が `kura.ddbj.nig.ac.jp` -> 内側 nginx（a012:28080）、`kura-s3.ddbj.nig.ac.jp` -> SeaweedFS S3（a012:28333）へ proxy する
- filer の port（HTTP 8888 / gRPC）は compose の内部 network に閉じ、ホスト外に公開しない

## SeaweedFS の pin

- デプロイする SeaweedFS は release tag に固定する。現在の pin: `4.37`
- upstream 公式の配布物のみを使う（fork / patch 禁止）
- 更新手順: pin する tag を上げ、[testing.md](./testing.md) の IAM policy boundary test・公開境界 test を含む一式が通ることを確認してから反映する

## 環境

| 環境 | Keycloak | SeaweedFS / nginx / frontend |
| --- | --- | --- |
| dev | DDBJ staging realm | local docker compose |
| staging | DDBJ staging realm | NIG オンプレミス |
| production | DDBJ production realm | NIG オンプレミス（gateway 経由で TLS 終端） |

- 環境差は env のみ: issuer URL、client id、S3 endpoint、公開 base URL、ファイル TTL、root credentials、STS signing key、filer JWT signing key
- dev も DDBJ staging realm を使う。ローカルに Keycloak は立てず、この repo に Keycloak のコンテナ・realm 定義を置かない（`kura-dev` client の redirect URI に localhost を登録して対応する）

## secret 管理

secret は env / secret 注入で渡し、repo・image・env の example ファイルに含めない。

- STS signing key: 決定論的な固定鍵（16 byte 以上、無いと SeaweedFS が起動しない）。鍵を差し替えると発行済みの一時 credentials が全失効する（ユーザーは再ログイン + STS 再取得で回復。データへの影響は無い）
- root credentials（s3.json の admin identity）: 運用スクリプト専用。通常経路（ユーザー操作）では使わない
- filer JWT signing key（`KURA_FILER_JWT_KEY`、security.toml の `jwt.filer_signing.key`）: filer の HTTP write と IAM gRPC を Bearer token 必須にするための鍵（[architecture.md](./architecture.md)）。差し替えは container 再作成で反映され、外部への影響は無い（署名は cluster 内で完結する）

## 日次運用タスク

定期実行が必要な運用タスクは compose の中で完結し、ホスト側に cron / systemd timer / logrotate を置かない。実行間隔は env `KURA_OPS_INTERVAL_SECONDS`（default 86400 = 日次）。失敗した回は次の通常間隔を待たず、5分後（通常間隔がそれより短い場合はそちらに合わせる）に再試行する。

- default quota reconciler: seaweedfs コンテナの entrypoint 内のループ。quota 未設定の bucket に `KURA_QUOTA_DEFAULT_MB`（default 1048576 = 1 TB）を適用する
- ops サービス（compose の `ops`、node 公式 image + `scripts/` 直接実行）が日次で行うもの:
  - 全ファイル TTL の削除（「全ファイル TTL」参照。`KURA_FILE_TTL_DAYS` が空ならスキップ）
  - 放置 multipart upload の掃除: part の最終アップロードから `KURA_MULTIPART_MAX_AGE_DAYS`（default 7）日を超えた未完了 multipart upload を破棄する。中断した upload の再開猶予がこの日数になる。未完了 part は一覧に見えないまま bucket の容量を消費するため、この掃除が容量リークを防ぐ
  - 監査ログの圧縮と期限削除（「監査ログ」参照）
- 手動で 1 回だけ実行する場合: `docker compose --env-file env.<環境> --env-file .env run --rm ops node /kura/scripts/ops-daily.ts`（`--now=<ISO 8601>` で判定時刻を上書きできる。リカバリ用）

## quota 運用

- default は 1 TB。新規 bucket への適用は reconciler（「日次運用タスク」参照）が行う
- 個別変更: admin が `weed shell` の `s3.bucket.quota -name=<bucket> -op=set -sizeMB=<N>` で bucket（= ユーザー）単位に変更する。weed shell の topology 系コマンドは `lock` を取ってから実行する（lock なしでは黙って no-op する）
- **`-op=disable` は使わない**: 無効化された quota は quota 未設定と外形上区別できず、reconciler が default を再適用してしまう。事実上の無制限にしたい場合は大きな値を set する
- `KURA_QUOTA_DEFAULT_MB` も同じ理由で正の整数のみ許容する。0 や負値は `-op=disable` と同じ「quota 未設定と区別不能」な状態を作るため、seaweedfs コンテナは起動時にこれを検証し、不正な値なら起動を失敗させる
- 超過時は enforcement（S3 server 内蔵、約 1 分周期）が bucket を read-only にし、upload がエラーで拒否される（HTTP 500）。使用量が quota を下回れば自動で解除される
- 解除の反映には遅延がある: 削除された分は volume の vacuum が走るまで使用量に反映されない。即時に解除したい場合は weed shell で `volume.vacuum -collection=<bucket>` -> `s3.bucket.quota.enforce -apply` を実行する

## 監査ログ

- 取得元は 2 系統。mutation（upload / delete / tagging）は DDBJ gateway の access log（`kura-s3.ddbj.nig.ac.jp` への全 S3 API が通り、client IP + method + path + query が記録される。設定レベルは確認済み、実地確認は配備チェックリスト参照）、public download は kura 内側 nginx の access log（下記）。SeaweedFS 自体は per-request の log を出さない
- path（bucket = username）で対象ユーザーに帰属させる。制約: admin が他ユーザーの bucket を操作した場合も bucket 所有者に帰属して見える
- 内側 nginx の public download ログ:
  - 公開配信の request だけを `KURA_LOG_DIR`（default `./logs`、a012 ではホストの恒久ディレクトリを指定）の日付付きファイル `access-YYYY-MM-DD.log` に書く。tab 区切りで時刻・client IP（gateway 付与の `X-Forwarded-For`、および直接の接続元 IP）・request line（encoded URI のまま）・status・バイト数・User-Agent
  - ファイル名の日付で日次に切り替わるため logrotate も reopen シグナルも不要。前日以前のファイルの gzip 圧縮と、保持期限（`KURA_AUDIT_RETENTION_DAYS`、default 1095 = 3 年）を過ぎたファイルの削除は ops サービスが日次で行う。前日ファイルの rotate は UTC 0:00 直後の nginx worker fd cache と race するため、UTC 0:00 から `KURA_AUDIT_ROTATE_LAG_SECONDS`（default 120）秒以内の実行では前日ファイルの rotate をスキップする（nginx の `open_log_file_cache` の inactive 60s より長い値にすること）
  - `$time_iso8601` が日付形式にマッチしない例外時は audit log への書き出しをスキップし、error_log で通知する（ops rotator が `access-date-unknown.log` を扱わないため）
  - ディレクトリは nginx の worker（uid 101）が書けること。compose の `kura-init` サービス（`alpine:3.20`）が起動時に `install -d -o 101 -g 101 -m 0755 /var/log/kura` で用意し、nginx / ops はこれを `depends_on: service_completed_successfully` で待ってから起動する。手動で用意する場合も `install -d -o 101 -g 101 <dir>` で揃える
- 保持期間: 3 年。gateway 側の access log にも同じ保持を依頼する（配備チェックリスト参照）
- 取得内容が不足する場合は SeaweedFS の audit log 機構（`-s3.auditLogConfig`、fluentd 形式）による構造化 event 取得を追加する
- 閲覧手段は当面ホスト上での直接参照（閲覧 UI は持たない）

## admin 運用

- admin membership: env `KURA_ADMIN_SUBS` に Keycloak の `sub`（UUID）をカンマ区切りで列挙する。反映は env 変更 + `docker compose up -d`（コンテナ再作成。hot reload は無い）。STS signing key が変わらない限り、発行済みの一時 credentials は再作成をまたいで有効なまま
- admin の操作手段は 2 つ:
  - `KuraAdminRole` で動く privileged な reference SPA（全 bucket にアクセスできる。仕組みは一般ユーザーと同じ STS + S3 API）
  - root credentials による運用スクリプト
- filer の metadata-only rename（`POST <dst>?mv.from=<src>`）は、大容量ファイルの即時 move が必要な場合に運用スクリプトからのみ使う。client に開放しない（filer API には S3 IAM の認可が効かないため）

## 全ファイル TTL

- TTL は env `KURA_FILE_TTL_DAYS`（日数。空 = 無効 = default）で設定する。SPA はこの値を `/_config.json` 経由で受け取り、各ファイルの有効期限表示に使う
- 削除は ops サービスの日次タスク（「日次運用タスク」参照）が行う: 作成時刻（= S3 の LastModified。object は不変なので一致する）+ TTL を過ぎた object を全 bucket から削除する（方式の根拠は [architecture.md](./architecture.md)）。削除の粒度は実行間隔（日次）
- 空フォルダは SPA が置く zero-byte marker `.keep`（末尾が `/.keep` または key 全体が `.keep`）で表現する。この marker は年齢に関わらず TTL sweep の対象外で、空フォルダが自己の age で消えることはない

## バックアップ・監視

- データのバックアップは行わない。kura は TTL を前提とした一時的な受け渡し場所であり、データの保全は利用者の責任とする（必要なデータは手元にも保持してもらう）
- 監視は最低限から始める:
  - 死活: `https://kura.ddbj.nig.ac.jp/healthz`（内側 nginx）と `https://kura-s3.ddbj.nig.ac.jp/healthz`（SeaweedFS S3）への HTTP 監視
  - 容量: a012 のディスク使用量（SeaweedFS のデータディレクトリ）。`-volume.max=0` は空きディスクから自動算出するため、ディスク逼迫が新規書き込み失敗として現れる
  - コンテナ: `docker compose ps` の稼働状態（ops サービスの停止は quota default / TTL / 監査ログ整理の停止を意味する）

## 配備チェックリスト（staging / production）

配備時に確認・実施する項目。完了したものから消し込む。

1. Keycloak client: production realm に `kura` client を作成する（public / PKCE S256 / redirect `https://kura.ddbj.nig.ac.jp/*` / web origins `https://kura.ddbj.nig.ac.jp` / dedicated scope に audience mapper / access token lifespan override 43200s。[architecture.md](./architecture.md) の Keycloak client）
2. env: `KURA_VOLUME_SIZE_LIMIT_MB` を空きディスクと合わせて決める（volume 1 本の上限。`-volume.max=0` が空きから本数を自動算出するため、`空きディスク / この値` が volume slot 数の上限になる。目安 30720 = 30 GB）。secrets（STS signing key / root credentials / filer JWT key）を新規生成して `.env` に置く
3. 監査ログ: `KURA_LOG_DIR` をホストの恒久ディレクトリに向ける（compose の `kura-init` サービスが起動時に uid 101 で書けるよう chown する。手動用意でも同じ所有権にする）。gateway の access log の実地確認: `kura-s3` への upload / delete / tagging（`?tagging` の query 含む）が client IP 付きで記録されること、保持 3 年が gateway 側の運用で担保されることを gateway 管理者と確認する
4. gateway の encoded URI 素通しの実地確認: space / `%` / 日本語を含む key の公開 URL が gateway 経由で 200 になること（設定レベルでは URI なし proxy_pass で確認済み）
5. CORS: gateway が preflight に応答し、SPA からの S3 API（PUT / multipart / presign PUT）がブラウザで通ること。`KURA_S3_ALLOWED_ORIGINS` は staging / production では SPA 配信 origin を明示する（`*` は test 専用）
6. 実測（100 GB クラス / 1 時間超）: 下記「大容量実測の手順」
7. E2E: 配備した環境の URL を `KURA_E2E_BASE_URL` に指定して `npm run test:e2e` が green になること（redirect URI に配備先 origin の登録が必要）

## 大容量実測の手順（配備時）

requirements の「100 GB クラス」「1 時間超の upload」「レジューム」を実環境で確認する:

1. 100 GB クラスのファイルを用意する（例: `head -c 100G /dev/urandom > big.bin`。ゼロ埋めは圧縮などで実態と乖離し得るため乱数にする）
2. ブラウザ（SPA）で upload し、完了後にサイズと内容（先頭・末尾数 MB の比較で可）を確認する。所要が 1 時間を超える場合、credentials provider の silent renew -> STS 再取得で途切れないこと（[architecture.md](./architecture.md) frontend）を兼ねて確認できる。回線が速く 1 時間未満で終わる場合はブラウザの DevTools でスループットを絞って 1 時間超を再現する
3. upload 途中でネットワークを切断（DevTools の offline）し、進捗 Toast の「再開」で続きから完了できること、完成ファイルが元と一致することを確認する
4. ブラウザを閉じて開き直し、「再開待ちのアップロード」からファイルを選び直して再開できることを確認する
5. 公開して恒久 URL から匿名 download し、内容が一致すること（gateway 経由のストリーミングと Range の確認を兼ねる）
