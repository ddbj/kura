# kura 要求仕様

kura は、認証付きで大容量ファイル（100 GB クラス）を upload / download でき、public 公開と presigned URL 発行もできる file server である。DDBJ / NIG のオンプレミス環境に設置し、BSI のサービスとして提供する。

技術仕様は [architecture.md](./architecture.md)、運用仕様は [operations.md](./operations.md)、テスト・検証仕様は [testing.md](./testing.md) を参照。

## ユースケース

kura が提供するのは次の 4 つのみ:

1. 認証されたユーザーが自分の領域にファイルを upload する（ブラウザから、100 GB クラス）
2. 認証されたユーザーが自分のファイルを一覧 / download / 削除する
3. ファイルを public にする（恒久 URL で誰でも download 可）。公開停止も対称に行える
4. presigned URL を発行する（短期のみ。長期共有は public 化 + 恒久 URL で代替する）

利用者はブラウザ（reference SPA）に限らない。CLI（aws cli 等）からも同じ操作ができ、他のサービス（例: Sapporo WES）がユーザーに代わって非対話でファイルを読み書きするプログラム利用も一級のユースケースである。

## 認証と利用者

- 認証は DDBJ account（Keycloak）の OIDC による。kura 独自のアカウントは持たない
- DDBJ account を持つユーザーは誰でも利用できる
- ユーザーの識別子は DDBJ account の username（`preferred_username` claim）
- 管理者（admin）向けの UI は設けない。全 bucket に対する運用操作は kura の root credentials で走るスクリプト（quota 変更・掃除・監査ログ整理）で行う（詳細は [operations.md](./operations.md)）

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

## public 公開

- ユーザーは自分のファイルを 1 ファイル単位で public にできる。public なファイルは恒久 URL `https://kura.ddbj.nig.ac.jp/<user>/<path>` で誰でも（認証なしで）download できる
- 公開停止も対称に、同じ操作感で行える。公開・公開停止はファイルサイズによらず即時に完了する
- 公開 URL はパスをそのまま用いる（不透明化しない）。URL から username とファイルパスが読める
- 非公開のファイルと存在しないファイルは、公開 URL 上では区別できない（どちらも 404）

## presigned URL

- ユーザーは自分のファイルに対して presigned URL（GET / PUT）を発行できる
- presign は短期の共有・受け渡し専用である。有効期間は発行に使った一時 credentials の残り時間で頭打ちになり、実効上限は約 12 時間（[architecture.md](./architecture.md) の「presign」を参照）
- 長期の共有には presign を使わず、public 化 + 恒久 URL で代替する

## SP による非対話利用

- 他のサービス（SP。例: Sapporo WES）が、ユーザーに代わって非対話で kura のファイルを読み書きできる（act-as-user）
- SP がアクセスできるのはそのユーザー自身の領域だけで、権限はユーザー本人と同じ
- ユーザーは自分の token を SP に渡すことで委譲する。長時間の処理には offline token を用いる（SP が refresh で access token を得続け、一時 credentials を再取得する。idle 30 日で失効する）

## quota

- 各ユーザーの領域には容量上限（quota）がある。default は 1 TB で、root credentials で走る運用スクリプトがユーザー単位に変更できる
- quota を超過すると新規の upload がエラーで拒否される（超過の判定は約 1 分周期で行われる）。download と削除は引き続き行え、削除で quota 内に戻せば upload は自動的に再開できる（ストレージの再整理を待つため反映には遅延がありうる。[operations.md](./operations.md) を参照）

## 全ファイル TTL

- デプロイ設定として、全ファイルの TTL（例: 30 日で自動削除）を有効化できる。default は無効
- TTL はファイル作成時刻を基準とし、public 化されたファイルを含む全ファイルに適用される
- 失効前の警告通知は行わない。ファイル単位の TTL 変更（override）もできない
- UI には各ファイルの有効期限（作成時刻 + TTL）を表示する

## ファイル名の制約

- ファイル名に kura 固有の制約は無い。space・`%`・`?`・`#`・日本語などを含む名前も upload・公開配信できる（S3 の object key として有効であればよい）

## 監査

- 誰がいつ何を操作したか（upload / 削除 / 公開・公開停止）と、public ファイルが download された記録を残す。詳細は [operations.md](./operations.md) を参照

## UI（reference SPA）

- ブラウザ向けの UI を提供する。日本語 / 英語対応
- UI は「kura の使い方の reference」であり、UI が無くても CLI 等で kura の全機能を利用できる

## 非機能要件

- 対象ファイルサイズ: 100 GB クラス
- ファイルの byte はブラウザ（または client）とストレージの間で直接転送する。経路上に kura 独自のアプリケーションサーバを挟まない
- 設置先: NIG オンプレミス。公開ドメインは `kura.ddbj.nig.ac.jp`（UI・公開配信）と `kura-s3.ddbj.nig.ac.jp`（S3 API）

## Non-goals

以下は kura では扱わない。必要になった場合も kura の外の別サービスとして検討する:

- GA4GH DRS / Passport、controlled access
- versioning
- メタデータ管理、checksum 検証、virus scan
- HTTP/3、Aspera
