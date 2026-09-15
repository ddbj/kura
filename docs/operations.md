# 運用

配備済みの kura を動かし続けるために知っておくことをまとめる。新規配備の手順は [deployment.md](./deployment.md)、そうなっている理由は [architecture.md](./architecture.md) にある。

## 稼働の形

compose の 3 サービスで完結する。

- **seaweedfs**: master / volume / filer / S3 / STS / IAM を 1 コンテナで動かす。永続データは `KURA_SEAWEEDFS_DATA_DIR` の bind mount 1 本に収まる（filer の LevelDB も同じ場所に作られる）
- **web**: SPA の静的ビルドを配信する。ファイルの byte は 1 バイトも通らない
- **ops**: 日次運用タスクを回す

外部から届いてよい port は SPA 配信（`KURA_HTTP_PORT`）と S3 API（`KURA_S3_PORT`）の 2 つだけで、filer と master は compose の内部 network に閉じている。公開 port の bind 先は `KURA_BIND_ADDR` で、default の `127.0.0.1` は開発機やテストが意図せず LAN に晒されないための値である。gateway が別ホストから来る配備先では明示的に広げる必要がある。

ストレージの構成は per-user bucket に合わせてある。bucket ごとに collection を消費するため、volume は 1 本ずつ増やし（entrypoint が生成する master.toml）、volume 数の上限は空きディスクからの自動算出に任せる。volume 1 本のサイズ上限は `KURA_VOLUME_SIZE_LIMIT_MB` で、100 GB クラスのファイルは複数 volume に分割保存されるので、この上限が実使用を制限することはない。

定期実行はすべて compose の中で完結する。ホスト側に cron や systemd timer は置かない。

## 環境と env

dev / staging / production の違いは env ファイルだけで、compose も image も同じものを使う。環境ごとに変わるのは issuer と client id、外向きの URL、データディレクトリ、TTL、quota の既定値、そして secret である。env の一覧と各値の意味は `env.dev` / `env.production` にコメント付きで並んでいるので、ここでは繰り返さない。

運用上、次の 3 点だけ知っておけばよい。

`KURA_QUOTA_DEFAULT_MB` と `KURA_OPS_INTERVAL_SECONDS` は起動時に正の整数であることを検証し、満たさなければ seaweedfs コンテナが起動に失敗する。どちらも quota reconciler のループが直接使う値で、不正な値を受け入れるとループがコンテナの寿命の間ずっと黙って止まるためである。

「空」の意味は env によって違う。`KURA_FILE_TTL_DAYS` の空は TTL 無効、`KURA_MULTIPART_MAX_AGE_DAYS` の空は既定値の採用を意味する。

env の変更はコンテナの再作成で反映する。hot reload の仕組みは無い。

## secret 管理

secret は env で渡し、repo・image・env の example ファイルには含めない。kura が持つ secret は 3 つある。

**STS signing key** は決定論的な固定鍵（16 byte 以上）で、無いと SeaweedFS が起動しない。差し替えると発行済みの一時 credentials が全て失効する。ユーザーは再ログインと STS の取り直しで回復でき、データへの影響は無い。

**root credentials** は s3.json に定義した固定の access key / secret key で、運用スクリプト専用である。ユーザー操作の経路では使わない。

**filer JWT signing key** は filer の HTTP read / write と IAM gRPC を Bearer token 必須にするための鍵で、security.toml の 2 つの鍵の項目に同じ値が入る。差し替えはコンテナの再作成で反映され、署名は cluster 内で完結するので外部への影響は無い。

このほか `KURA_ADMIN_SUBS` は秘密ではないが、権限の割り当てそのものなので secret と同じく `.env` に置く。

## 日次運用タスク

実行間隔は `KURA_OPS_INTERVAL_SECONDS`（default 86400 = 日次）。失敗した回は次の通常間隔を待たず、5 分後（通常間隔がそれより短ければそちらに合わせて）再試行する。

default quota reconciler は seaweedfs コンテナの entrypoint 内のループで、quota 未設定の bucket に `KURA_QUOTA_DEFAULT_MB` を適用する。

ops サービスは 2 つのタスクを持つ。1 つは全ファイル TTL の削除（「全ファイル TTL」参照）。もう 1 つは放置された multipart upload の掃除で、part の最終アップロードから `KURA_MULTIPART_MAX_AGE_DAYS`（default 7）日を超えた未完了 upload を破棄する。中断した upload の再開猶予がこの日数になる。未完了の part は一覧に見えないまま bucket の容量を消費するので、この掃除が容量リークを防いでいる。part を 1 つも持たない upload は日付を決められないため対象外で、容量も消費していない。

削除に失敗した object が 1 つでもあれば、その bucket はその回の失敗として扱われ、上記の再試行に乗る。

手動で 1 回だけ回すこともできる。`--now=<ISO 8601>` で判定時刻を上書きできるので、取りこぼしのリカバリに使える。

```sh
docker compose --env-file env.<環境> --env-file .env run --rm ops node /kura/scripts/ops-daily.ts
```

## quota 運用

quota の既定値は 1 TB で、新規 bucket への適用は reconciler が行う。ユーザー単位の変更は admin が `weed shell` から行う。

```sh
s3.bucket.quota -name=<bucket> -op=set -sizeMB=<N>
```

weed shell の topology 系コマンド（`volume.vacuum` 等）は `lock` を取ってから実行する。lock なしでは黙って no-op する。

`-op=disable` は使わない。無効化された quota は `s3.bucket.list` 上で未設定と区別できず、reconciler が default を再適用してしまうためである。事実上の無制限にしたい場合は大きな値を set する。`KURA_QUOTA_DEFAULT_MB` に 0 や負値を置けないのも同じ理由による。

quota を超過すると bucket が read-only になり、upload がエラーで拒否される（判定は約 1 分周期）。使用量が quota を下回れば自動で解除されるが、削除した分は volume の vacuum が走るまで使用量に反映されないため、解除には遅延がある。即時に解除したい場合は weed shell で `volume.vacuum -collection=<bucket>` を実行してから `s3.bucket.quota.enforce -apply` する。

ユーザー単位に変更した quota は UI に出ない。SPA の使用量メーターの分母はビルド時に焼き込んだ既定値で、S3 API から実際の quota 設定値を読む手段が無いためである（[architecture.md](./architecture.md) の「quota と TTL の実現」）。既定値から変えた bucket があるなら、その差は UI 以外の手段で本人に伝える。

## 全ファイル TTL

TTL は `KURA_FILE_TTL_DAYS`（日数。空なら無効で、これが default）で設定する。SPA はこの値をビルド時に取り込んで各ファイルの有効期限表示に使うので、TTL の変更は SPA の再ビルドと web の再作成を伴う。

削除は ops の日次タスクが行う。作成時刻（S3 の LastModified。object は不変なので作成時刻と一致する）に TTL を足した時刻を過ぎた object を、全 bucket から削除する。したがって削除の粒度は実行間隔（日次）になる。空フォルダを表す `.keep` marker は、年齢に関わらず対象外である。

## admin 操作

admin 向けの UI は無く、手段は 2 つとも CLI である。

root credentials は日次運用タスクが使うもので、手で使うのは S3 経路が壊れていて原因を切り分けたいときに限る。

通常の admin 操作には `KuraAdminRole` を使う。`KURA_ADMIN_SUBS` に列挙した Keycloak の `sub` を持つユーザーだけが、自分の access token でこの role を assume できる。使い方は一般ユーザーと同じ STS + S3 で、違うのは `RoleArn` を明示する点だけである。

```sh
aws sts assume-role-with-web-identity \
  --endpoint-url "$KURA_S3_ENDPOINT" \
  --role-arn arn:aws:iam::role/KuraAdminRole \
  --role-session-name kura-admin \
  --web-identity-token "$ACCESS_TOKEN"
```

返った一時 credentials を `AWS_*` に入れれば、`aws s3` が全 bucket に対して使える。`sub` は対象ユーザーの access token の `sub` claim（Keycloak の admin console が表示するユーザー ID と同じ）で調べる。`KURA_ADMIN_SUBS` の変更はコンテナの再作成で反映され、STS signing key が変わらない限り、発行済みの一時 credentials は再作成をまたいで有効なままである。

filer の metadata-only rename（`POST <dst>?mv.from=<src>`）は、大容量ファイルの即時 move が必要な場合に運用スクリプトからのみ使う。filer API には S3 の IAM が効かないので、client には開放しない。

## 監査ログ

kura のファイル操作はすべて S3 API として前段の gateway を通るため、監査の情報源は gateway の access log 1 本である（client IP・method・path・query が記録される）。SeaweedFS は per-request の log を出さず、kura のコンテナは監査ログを持たない。

path に含まれる bucket 名が username なので、操作は対象ユーザーに帰属させられる。admin が他ユーザーの bucket を操作した場合も、bucket 所有者に帰属して見える点だけ注意する。

保持期間は gateway 側の access log の運用に従う。kura は独自の保持期間を規定せず、log の保存にも rotate にも関与しない。閲覧手段は当面ホスト上での直接参照で、閲覧 UI は持たない。記録の内容が足りない場合は、SeaweedFS の audit log 機構（`-s3.auditLogConfig`、fluentd 形式）による構造化 event の取得を追加する。

## 監視とバックアップ

データのバックアップは行わない。kura は TTL を前提とした一時的な受け渡し場所であり、データの保全は利用者の責任とする（必要なデータは手元にも持ってもらう）。

監視は 3 点から始める。

- 死活: SPA 配信の `/` と S3 API の `/healthz` への HTTP 監視
- 容量: データディレクトリのディスク使用量。volume 数の上限は空きディスクから自動算出されるため、ディスク逼迫は新規書き込みの失敗として現れる
- コンテナの稼働状態: ops サービスの停止は、TTL 削除と multipart 掃除の停止を意味する
