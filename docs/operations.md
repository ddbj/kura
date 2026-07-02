# kura 運用仕様

要求仕様は [requirements.md](./requirements.md)、技術仕様は [architecture.md](./architecture.md)、テスト・検証仕様は [testing.md](./testing.md) を参照。

## デプロイ構成

- 稼働ノード: NIG オンプレミスの a012（`172.19.15.12`）
- docker compose で SeaweedFS 一式と kura 内側 nginx を動かす。port は内側 nginx = 28080、SeaweedFS S3 = 28333
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

- default は 1 TB。新規 bucket に適用する（適用手段は未確定。[architecture.md](./architecture.md) 参照）
- 個別変更: admin が `weed shell` の `s3.bucket.quota -op=set` で bucket（= ユーザー）単位に変更する
- 超過時は bucket が read-only になり upload が 403 で拒否される。ユーザーが削除で quota 内に戻したときの解除挙動（自動解除か、反映までの遅延）は未確定（実測で確定する）

## 監査ログ

- 取得元: DDBJ gateway と S3 endpoint の access log。mutation（upload / delete / tagging）と public download を対象とし、path（bucket = username）で対象ユーザーに帰属させる
- 保存先: a012 ローカルのファイル。logrotate で rotate する
- 保持期間: 3 年
- access log だけで監査要件（[requirements.md](./requirements.md) の「監査」）を満たせるかは検証で確定する。不足する場合は filer の metadata 変更購読による構造化 event 取得を追加する
- 閲覧手段は当面ホスト上での直接参照（閲覧 UI は持たない）

## admin 運用

- admin membership: kura 側の設定ファイルに Keycloak の `sub`（UUID）を列挙する。リスト更新の反映方法（hot reload の可否、再起動の要否）は未確定（実測で確定する）
- admin の操作手段は 2 つ:
  - `KuraAdminRole` で動く privileged な reference SPA（全 bucket にアクセスできる。仕組みは一般ユーザーと同じ STS + S3 API）
  - root credentials による運用スクリプト
- filer の metadata-only rename（`POST <dst>?mv.from=<src>`）は、大容量ファイルの即時 move が必要な場合に運用スクリプトからのみ使う。client に開放しない（filer API には S3 IAM の認可が効かないため）

## バックアップ・監視

未定。方針が決まり次第ここに追記する。
