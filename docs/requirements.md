# kura 要求仕様

kura は、DDBJ account で認証したユーザーが、自分専用の領域に大容量ファイル（100 GB クラス）を置いて読み書きできるストレージ基盤である。ブラウザからも CLI からも、ユーザーが認可した他サービス（SP）からも、同じ領域に同じ権限でアクセスできる。DDBJ / NIG のオンプレミス環境に設置し、BSI のサービスとして提供する。

技術仕様は [architecture.md](./architecture.md)、運用仕様は [operations.md](./operations.md)、テスト・検証仕様は [testing.md](./testing.md) を参照。

## ユースケース

kura が提供するのは次の 3 つのみ:

1. 認証されたユーザーが自分の領域にファイルを upload する（ブラウザから、100 GB クラス）
2. 認証されたユーザーが自分のファイルを一覧 / download / 削除する
3. 短期の受け渡しのために presigned URL を発行する

利用者はブラウザ（reference SPA）に限らない。CLI（aws cli 等）からも同じ操作ができ、他のサービス（例: Sapporo WES）がユーザーに代わって非対話でファイルを読み書きするプログラム利用も一級のユースケースである。

kura のファイルに触れるのは、本人と、本人が明示的に権限を委譲した相手だけである。認証を持たない第三者に向けてファイルを配信する経路を kura は持たない（[Non-goals](#non-goals) 参照）。

## 認証と利用者

- 認証は DDBJ account（Keycloak）の OIDC による。kura 独自のアカウントは持たない
- DDBJ account を持つユーザーは誰でも利用できる
- ユーザーの識別子は DDBJ account の username（`preferred_username` claim）
- 管理者（admin）向けの UI は設けない。全 bucket に対する運用操作は kura の root credentials で走るスクリプト（quota 変更・掃除）で行う（詳細は [operations.md](./operations.md)）

## ファイル領域

- 各ユーザーは自分専用の領域を持ち、その中に任意のディレクトリ構造でファイルを置ける
- ファイルは `<user>/<path>` で識別する。他ユーザーの領域にはアクセスできない（読み書き・一覧とも）
- 領域はユーザーが初めて upload した時点で自動的に作られる。事前の申請・作成手続きは無い
- username が S3 bucket の命名規則に適合しないユーザー（`_` を含む・`-` で終わる等）は kura を利用できない（詳細は [architecture.md](./architecture.md) の「配置」を参照）

## upload

- ブラウザまたは S3 client から、100 GB クラスのファイルを upload できる
- 1 時間を超える upload も中断なく継続できる
- 中断した upload は再開（レジューム）できる（multipart upload の完了済み part を引き継ぐ。認証セッションを取り直しても再開できる）

## download・一覧・削除

- 認証されたユーザーは自分のファイルを一覧・download・削除できる
- 削除は即時の完全消去である。ゴミ箱・復旧猶予は設けない

## presigned URL

- ユーザーは自分のファイルに対して presigned URL（GET / PUT）を発行できる。認証を持たない相手にファイルを渡す・受け取るための、短期の受け渡し専用の手段である
- 有効期間の実効上限は約 12 時間である。これは SeaweedFS の STS が一時 credentials の寿命に固定上限を持つためで、kura 側の設定では変えられない（[architecture.md](./architecture.md) の「presign」を参照）
- presigned URL の生成は client 側で完結する署名計算であり、kura に発行 API は無い。一時 credentials を持つ者は誰でも発行できるため、kura 側でこれを禁止する手段は存在しない。UI が発行操作を提供するのは、S3 client でできることの reference としてである
- 12 時間を超える共有の手段は kura では提供しない

## SP による非対話利用

- 他のサービス（SP。例: Sapporo WES）が、ユーザーに代わって非対話で kura のファイルを読み書きできる（act-as-user）
- SP がアクセスできるのはそのユーザー自身の領域だけで、権限はユーザー本人と同じ
- ユーザーは自分の token を SP に渡すことで委譲する。長時間の処理には offline token を用いる（SP が refresh で access token を得続け、一時 credentials を再取得する。idle 30 日で失効する）

## quota

- 各ユーザーの領域には容量上限（quota）がある。default は 1 TB で、root credentials で走る運用スクリプトがユーザー単位に変更できる
- quota を超過すると新規の upload がエラーで拒否される（超過の判定は約 1 分周期で行われる）。download と削除は引き続き行え、削除で quota 内に戻せば upload は自動的に再開できる（ストレージの再整理を待つため反映には遅延がありうる。[operations.md](./operations.md) を参照）

## 全ファイル TTL

- デプロイ設定として、全ファイルの TTL（例: 30 日で自動削除）を有効化できる。default は無効
- TTL はファイル作成時刻を基準とし、全ファイルに一律で適用される
- 失効前の警告通知は行わない。ファイル単位の TTL 変更（override）もできない
- UI には各ファイルの有効期限（作成時刻 + TTL）を表示する

## ファイル名の制約

- ファイル名に kura 固有の制約は無い。space・`%`・`?`・`#`・日本語などを含む名前も扱える（S3 の object key として有効であればよい）

## 監査

- 誰がいつ何を操作したか（upload / download / 削除）の記録を残す。kura はすべてのファイル操作を S3 API として受けるため、記録は kura の前段にある DDBJ gateway の access log で取得する。詳細は [operations.md](./operations.md) を参照

## UI（reference SPA）

- ブラウザ向けの UI を提供する。日本語 / 英語対応
- UI は「kura の使い方の reference」であり、UI が無くても CLI 等で kura の全機能を利用できる

## 非機能要件

- 対象ファイルサイズ: 100 GB クラス
- ファイルの byte はブラウザ（または client）とストレージの間で直接転送する。経路上に kura 独自のアプリケーションサーバを挟まない
- 設置先: NIG オンプレミス。公開ドメインは `kura.ddbj.nig.ac.jp`（UI）と `kura-s3.ddbj.nig.ac.jp`（S3 API）

## Non-goals

以下は kura では扱わない。必要になった場合も kura の外の別サービスとして検討する:

- 認証を持たない第三者へのファイル配信（public 公開）。kura は本人と本人の delegate のための領域であり、世間に向けた配信路を持たない。公開配信が必要なものは、それを担うサービス側に置く
- 12 時間を超える共有。presigned URL が唯一の共有手段であり、それを超える長期共有の仕組みは持たない
- GA4GH DRS / Passport、controlled access
- versioning
- メタデータ管理、checksum 検証、virus scan
- HTTP/3、Aspera
