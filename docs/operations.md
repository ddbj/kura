# kura 運用仕様

要求仕様は [requirements.md](./requirements.md)、技術仕様は [architecture.md](./architecture.md)、テスト・検証仕様は [testing.md](./testing.md) を参照。

## デプロイ構成

- 稼働ノード: NIG オンプレミスの a012（`172.19.15.12`）
- docker compose で SeaweedFS 一式と kura 内側 nginx を動かす。port は内側 nginx = 28080、SeaweedFS S3 = 28333
- 起動は `docker compose --env-file env.<環境> --env-file .env up -d --wait`（`.env` は git 管理外の secret。「secret 管理」参照）
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

- 環境差は env のみ: issuer URL、client id、S3 endpoint、公開 base URL、root credentials、STS signing key
- dev も DDBJ staging realm を使う。ローカルに Keycloak は立てず、この repo に Keycloak のコンテナ・realm 定義を置かない（`kura-dev` client の redirect URI に localhost を登録して対応する）

## secret 管理

secret は env / secret 注入で渡し、repo・image・env の example ファイルに含めない。

- STS signing key: 決定論的な固定鍵（16 byte 以上、無いと SeaweedFS が起動しない）。鍵を差し替えると発行済みの一時 credentials が全失効する（ユーザーは再ログイン + STS 再取得で回復。データへの影響は無い）
- root credentials（s3.json の admin identity）: 運用スクリプト専用。通常経路（ユーザー操作）では使わない

## quota 運用

- default は 1 TB。quota 未設定の bucket に default を設定する reconciler スクリプトを定期実行して適用する（スクリプトは未整備。整備後にここへ手順を追記する）
- 個別変更: admin が `weed shell` の `s3.bucket.quota -name=<bucket> -op=set -sizeMB=<N>` で bucket（= ユーザー）単位に変更する。weed shell の topology 系コマンドは `lock` を取ってから実行する（lock なしでは黙って no-op する）
- 超過時は enforcement（S3 server 内蔵、約 1 分周期）が bucket を read-only にし、upload がエラーで拒否される（HTTP 500）。使用量が quota を下回れば自動で解除される
- 解除の反映には遅延がある: 削除された分は volume の vacuum が走るまで使用量に反映されない。即時に解除したい場合は weed shell で `volume.vacuum -collection=<bucket>` -> `s3.bucket.quota.enforce -apply` を実行する

## 監査ログ

- 取得元は 2 系統。mutation（upload / delete / tagging）は DDBJ gateway の access log（`kura-s3.ddbj.nig.ac.jp` への全 S3 API が通り、method + path + query が記録される）、public download は kura 内側 nginx の access log（`GET /<user>/<path>` + status + client IP）。SeaweedFS 自体は per-request の log を出さない
- path（bucket = username）で対象ユーザーに帰属させる。制約: admin が他ユーザーの bucket を操作した場合も bucket 所有者に帰属して見える
- 保存先: a012 ローカルのファイル。logrotate で rotate する
- 保持期間: 3 年
- gateway 側の log 内容が上記を満たすことの実地確認は未実施（配備時に確認する）。不足する場合は SeaweedFS の audit log 機構（`-s3.auditLogConfig`、fluentd 形式）による構造化 event 取得を追加する
- 閲覧手段は当面ホスト上での直接参照（閲覧 UI は持たない）

## admin 運用

- admin membership: env `KURA_ADMIN_SUBS` に Keycloak の `sub`（UUID）をカンマ区切りで列挙する。反映は env 変更 + `docker compose up -d`（コンテナ再作成。hot reload は無い）。STS signing key が変わらない限り、発行済みの一時 credentials は再作成をまたいで有効なまま
- admin の操作手段は 2 つ:
  - `KuraAdminRole` で動く privileged な reference SPA（全 bucket にアクセスできる。仕組みは一般ユーザーと同じ STS + S3 API）
  - root credentials による運用スクリプト
- filer の metadata-only rename（`POST <dst>?mv.from=<src>`）は、大容量ファイルの即時 move が必要な場合に運用スクリプトからのみ使う。client に開放しない（filer API には S3 IAM の認可が効かないため）

## 全ファイル TTL

- 有効化する場合は、作成時刻 + TTL を過ぎた object を削除する日次スクリプトを動かす（方式の根拠は [architecture.md](./architecture.md)）。スクリプトは未整備。整備後にここへ手順を追記する

## バックアップ・監視

未定。方針が決まり次第ここに追記する。
