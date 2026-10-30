# 運用

配備済みの kura を動かし続けるために、運用者が知っておくことをまとめる。新規配備の手順は [deployment.md](./deployment.md) に、kura が今の形になっている理由は [architecture.md](./architecture.md) にある。

## 稼働の形

kura は compose の 3 サービスだけで動く。

- seaweedfs: master・volume・filer・S3・STS・IAM を 1 つのコンテナで動かす。永続データは、`KURA_SEAWEEDFS_DATA_DIR` の 1 つの bind mount に収まる（filer の LevelDB も同じ場所に作られる）
- web: SPA の静的ビルドを配信する。ファイルの byte は web を 1 バイトも通らない
- ops: 日次運用タスクを実行する

外部から接続を受けてよい port は、SPA の配信（`KURA_HTTP_PORT`）と S3 API（`KURA_S3_PORT`）の 2 つだけである。filer と master は、compose の内部 network の中だけで使う。公開 port の bind 先は `KURA_BIND_ADDR` で決まる。既定値の `127.0.0.1` は、開発機やテストの port が意図せず LAN に公開されないための値である。gateway が別のホストから接続する配備先では、`KURA_BIND_ADDR` を、gateway から届くアドレスに明示的に変える必要がある。

ストレージの構成は、per-user bucket に合わせてある。SeaweedFS は bucket ごとに collection を作るので、entrypoint が生成する master.toml で、volume を 1 本ずつ増やす設定にしている。volume 数の上限は、SeaweedFS が空きディスクから自動で決める。volume 1 本のサイズ上限は `KURA_VOLUME_SIZE_LIMIT_MB` である。100 GB クラスのファイルは複数の volume に分けて保存されるので、volume 1 本のサイズ上限が実際の利用を制限することはない。

データを置くファイルシステムの空きが `KURA_VOLUME_MIN_FREE_SPACE`（SeaweedFS の `-volume.minFreeSpace`）を下回ると、SeaweedFS は全 volume を read-only にし、全ユーザーの upload を拒否する。`KURA_VOLUME_MIN_FREE_SPACE` の既定値は、SeaweedFS と同じ 1% である。データを大きな共有ファイルシステムに置く環境では、`KURA_VOLUME_MIN_FREE_SPACE` を容量（例: `100GiB`）で指定する。共有ファイルシステムでは、1% に当たる容量でも kura が使う量よりずっと大きく、空きが十分にあるうちに upload が止まるためである。

定期実行はすべて compose の中で行う。ホストには cron も systemd timer も置かない。

## 環境と env

環境は dev・staging・production の 3 つで、環境の違いは env ファイル（`env.dev`・`env.staging`・`env.production`）の中身だけである。compose ファイルはどの環境でも同じものを使う。web と ops の image は、SPA に埋め込む値が環境ごとに違うので、環境ごとにその環境の env でビルドする。環境ごとに変わるのは、issuer と client id、外向きの URL、公開 port、データディレクトリ、TTL、quota の既定値、secret である。

staging は SP の接続テストに使う。staging は DDBJ account の staging realm で認証するので、SP は production の DDBJ account の設定を変えずに接続を試せる。staging は production と同じホストに置けるように、公開 port とデータディレクトリを production と分けてあり、compose の project 名も分けて起動する（[deployment.md](./deployment.md)）。env の一覧と各値の意味は、`env.dev` と `env.production` にコメント付きで並んでいるので、ここでは繰り返さない。

運用では、次の 3 点を知っておけばよい。

- seaweedfs コンテナは、起動時に `KURA_QUOTA_DEFAULT_MB` と `KURA_OPS_INTERVAL_SECONDS` が正の整数であることを検証し、正の整数でなければ起動に失敗する。どちらも quota reconciler のループが直接使う値で、不正な値を受け入れると、ループが止まったまま、コンテナが動いている間ずっとエラーも出ないためである
- 値が空のときの意味は、env の変数によって違う。`KURA_FILE_TTL_DAYS` が空なら TTL は無効で、`KURA_MULTIPART_MAX_AGE_DAYS` が空なら既定値を使う
- env の変更は、コンテナを作り直すと反映される。作り直さずに反映する仕組みは無い

## secret 管理

運用者は secret を git 管理外の `.env` に置いて compose に渡し、repo・image・env の example ファイルには入れない。kura の secret は次の 3 つである。

- STS signing key: 起動のたびに変わらない固定の鍵（16 byte 以上）で、無いと SeaweedFS が起動しない。鍵を差し替えると、発行済みの一時 credentials がすべて失効する。ユーザーは再ログインして STS から一時 credentials を取り直せば元どおり使え、データへの影響は無い
- root credentials: s3.json に定義した固定の access key と secret key で、運用スクリプトだけが使う。ユーザー操作の経路では使わない
- filer JWT signing key: filer の HTTP の read・write と IAM の gRPC に Bearer token を必須にするための鍵である。entrypoint は、security.toml の `jwt.filer_signing.key` と `jwt.filer_signing.read.key` の両方にこの鍵を書く。鍵の差し替えはコンテナを作り直すと反映され、署名は cluster の中だけで使うので、外部への影響は無い

`KURA_ADMIN_SUBS` は秘密の値ではないが、権限の割り当てそのものなので、secret と同じく `.env` に置く。

## 日次運用タスク

実行間隔は `KURA_OPS_INTERVAL_SECONDS`（既定値は 86400 秒 = 1 日）である。ある回が失敗すると、次の通常の実行を待たずに 5 分後に再試行する。通常の実行間隔が 5 分より短いときは、通常の実行間隔で再試行する。

quota reconciler は、seaweedfs コンテナの entrypoint の中のループである。quota reconciler は、quota が未設定の bucket に `KURA_QUOTA_DEFAULT_MB` を設定する。

ops サービスは、次の 3 つの処理を実行する。

1. TTL を過ぎたファイルの削除（「全ファイル TTL」）
2. 放置された multipart upload の掃除。part を最後にアップロードしてから `KURA_MULTIPART_MAX_AGE_DAYS`（既定値は 7）日を超えた、未完了の upload を破棄する。中断した upload を再開できる猶予は、この日数になる。未完了の part は一覧に表示されないまま bucket の容量を使うので、掃除しないと使われない容量が増え続ける。part を 1 つも持たない upload は、最後のアップロードの日付が無いので対象外である。part を持たない upload は容量も使っていない
3. versioning が有効な bucket の、古い version と delete marker の削除。TTL の設定に関係なく、毎回すべて削除する。versioning が有効になるのは、ユーザーが CLI で Object Lock を有効にして作った bucket だけである（[architecture.md](./architecture.md) の「quota と TTL の実現」）。対象の bucket があると、ops はその bucket 名と削除した数を出力に書く

削除に失敗した object が 1 つでもある bucket は、その回の失敗として記録され、その回は上記の再試行の対象になる。

ops の処理は、手動で 1 回だけ実行することもできる。`--now=<ISO 8601>` を付けると、期限の判定に使う時刻を上書きできるので、処理されなかった分を後から処理するときに使える。

```sh
docker compose --env-file env.<環境> --env-file .env run --rm ops node /kura/scripts/ops-daily.ts
```

## quota 運用

quota の既定値は 1 TiB（`KURA_QUOTA_DEFAULT_MB`）で、新しい bucket には quota reconciler が既定値を設定する。ユーザー単位の変更は、admin が `weed shell` から行う。

```sh
s3.bucket.quota -name=<bucket> -op=set -sizeMB=<N>
```

weed shell の topology 系のコマンド（`volume.vacuum` など）は、`lock` を取ってから実行する。`lock` を取らずに実行すると、エラーを出さずに何もしない。

`-op=disable` は使わない。disable した quota は `s3.bucket.list` の表示で未設定の quota と区別できず、quota reconciler が既定値を設定し直すためである。事実上の無制限にしたいときは、大きな値を set する。`KURA_QUOTA_DEFAULT_MB` に 0 や負の値を設定できないのも、`-op=disable` を使わないのと同じ理由である。

使用量が quota を超えると、bucket が read-only になり、upload がエラーで拒否される（判定は約 1 分ごと）。使用量が quota を下回れば read-only は自動で解除される。ただし、削除した分は volume の vacuum が実行されるまで使用量に反映されないので、解除は遅れる。すぐに解除したいときは、weed shell で `volume.vacuum -collection=<bucket>` を実行してから、`s3.bucket.quota.enforce -apply` を実行する。

ユーザー単位に変更した quota は UI に表示されない。SPA の使用量メーターの分母はビルド時に埋め込んだ既定値で、一般ユーザーには実際の quota の設定値を読む権限が無いためである（[architecture.md](./architecture.md) の「quota と TTL の実現」）。既定値から quota を変えた bucket があるなら、既定値との違いは UI 以外の手段で本人に伝える。

## 全ファイル TTL

TTL は `KURA_FILE_TTL_DAYS`（日数）で設定する。`KURA_FILE_TTL_DAYS` が空なら TTL は無効で、既定値は空である。SPA はこの値をビルド時に取り込み、各ファイルの有効期限の表示に使う。そのため TTL を変えるときは、image を作り直してから web と ops を作り直す（[deployment.md](./deployment.md) の「更新」）。

削除は ops の日次運用タスクが行う。ops は、作成時刻に TTL を足した時刻を過ぎた object を、全 bucket から削除する。作成時刻には S3 の LastModified を使う。object は書き換えられないので、LastModified は作成時刻と一致する。したがって、ファイルを削除するタイミングの細かさは実行間隔（日次）になる。空フォルダを表す `.keep` は、作成からの経過時間に関わらず削除しない。versioning が有効な bucket で TTL の削除が残した古い version は、同じ日次運用タスクの 3 つ目の処理が削除する。

## admin 操作

admin 向けの UI は無く、admin は CLI で操作する。CLI で使う権限は、root credentials と `KuraAdminRole` の 2 つである。

root credentials は日次運用タスクが使うものである。admin が root credentials を手で使うのは、S3 の経路が壊れていて、原因を切り分けたいときに限る。

通常の admin 操作には `KuraAdminRole` を使う。`KURA_ADMIN_SUBS` に列挙した Keycloak の `sub` を持つユーザーだけが、自分の access token で `KuraAdminRole` を assume できる。使い方は一般ユーザーと同じ STS + S3 で、違うのは `RoleArn` を明示する点だけである。

```sh
aws sts assume-role-with-web-identity \
  --endpoint-url "$KURA_S3_ENDPOINT" \
  --role-arn arn:aws:iam::role/KuraAdminRole \
  --role-session-name kura-admin \
  --web-identity-token "$ACCESS_TOKEN"
```

返ってきた一時 credentials を `AWS_*` の環境変数に入れれば、`aws s3` で全 bucket を操作できる。ユーザーの `sub` は、そのユーザーの access token の `sub` claim で調べる（Keycloak の admin console が表示するユーザー ID と同じ値である）。`KURA_ADMIN_SUBS` の変更は、コンテナを作り直すと反映される。STS signing key を変えない限り、発行済みの一時 credentials は、コンテナを作り直したあとも有効なままである。

filer の API には S3 の IAM が効かないので、filer の metadata-only rename（`POST <dst>?mv.from=<src>`）は client に開放しない。

## 監査ログ

kura のファイル操作は、すべて S3 API として前段の gateway を通る。そのため、監査に使える記録は gateway の access log だけである（client IP・method・path・query が記録される）。SeaweedFS は request ごとの log を出さず、kura のコンテナも監査ログを持たない。

path に含まれる bucket 名は username なので、access log の操作を対象のユーザーに結び付けられる。ただし、admin が他のユーザーの bucket を操作した場合も、access log ではその bucket の所有者の操作に見える。

access log の保持期間は、gateway 側の access log の運用に従う。kura は独自の保持期間を決めず、log の保存にも rotate にも関与しない。kura は閲覧 UI を持たず、運用者は gateway のホスト上で access log を直接読む。

## コンテナの出力

rootless podman で配備したコンテナの出力（stdout と stderr）は、`compose.podman.yml` の設定によって、podman が `KURA_LOG_DIR/<service>.log`（`seaweedfs.log`・`web.log`・`ops.log`）に書く。podman の log driver には `k8s-file` を使う。各行の先頭には、時刻と `stdout` / `stderr` が付く。日次運用タスクの結果は、1 回の実行ごとに ops の出力に 1 行出る。失敗は stderr に出る。

- podman の既定の journald に書かないのは、ホストの journald の保存量がホスト全体で決まるためである。同じホストの他の出力が多いと、数十分前の行も消える。web は起動したときに、ops は日次運用タスクの 1 回ごとに、数行しか書かない。journald に書くと、運用者が読む前に他の出力に押し出されて消える
- `KURA_LOG_DIR` は、`KURA_SEAWEEDFS_DATA_DIR` と別のディスクにする。データのディスクが応答しなくなったときのエラーを、ログに残すためである。同じディスクに書くと、ディスクが応答しなくなったときにログの書き込みも止まり、stdout に書こうとした process も止まる
- コンテナを作り直しても、podman は同じファイルに追記する。ログのファイルは消さず、rotate もしない。ログが増える主な原因は seaweedfs の出力で、データのディスクの使用率が 95% を超えている間は、seaweedfs が数秒に 1 行を出す（1 環境で年に 2 GB 程度）
- 配備先では、healthcheck の間隔を 30 秒にする（`compose.podman.yml`）。podman は healthcheck を 1 回実行するごとに journald に記録する。`compose.yml` の 2 秒のままにすると、kura の healthcheck の記録がホストの journald の保存量を使い切り、同じホストの他のサービスのログが消える。2 秒は、dev とテストで `up --wait` を早く終えるための値である

```sh
tail -f <KURA_LOG_DIR>/ops.log          # 日次運用タスクの結果を見る
grep ' stderr ' <KURA_LOG_DIR>/ops.log  # 日次運用タスクのエラーを見る
```

## 監視とバックアップ

データのバックアップは取らない。kura は一時的な受け渡しの場所であり、データの保全は利用者の責任とする（必要なデータは手元にも持ってもらう）。

監視は次の 3 点から始める。

- 死活: SPA の配信の `/` と、S3 API の `/healthz` への HTTP 監視
- 容量: データディレクトリのファイルシステムの空き。空きが `KURA_VOLUME_MIN_FREE_SPACE` を下回ると、全ユーザーの upload が止まる（「稼働の形」）
- コンテナの稼働状態: ops サービスが止まると、日次運用タスクも止まる。日次運用タスクの失敗は、ops の出力の stderr に出る（「コンテナの出力」）
