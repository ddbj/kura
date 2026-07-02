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
- 管理者（admin）は kura 側の設定に列挙されたユーザーで、全ユーザーの領域を操作できる

## ファイル領域

- 各ユーザーは自分専用の領域を持ち、その中に任意のディレクトリ構造でファイルを置ける
- ファイルは `<user>/<path>` で識別する。他ユーザーの領域にはアクセスできない（読み書き・一覧とも）
- 領域はユーザーが初めて upload した時点で自動的に作られる。事前の申請・作成手続きは無い

## upload

- ブラウザまたは S3 client から、100 GB クラスのファイルを upload できる
- 1 時間を超える upload も中断なく継続できる
- 中断した upload の再開（レジューム）は未確定。実測で可能と確認できた場合に対応する

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
- presign は短期の共有・受け渡し専用である。TTL の実効上限は未確定（一時 credentials の有効期間に依存するため、実測で確定して本仕様に明記する）
- 長期の共有には presign を使わず、public 化 + 恒久 URL で代替する

## SP による非対話利用

- 他のサービス（SP。例: Sapporo WES）が、ユーザーに代わって非対話で kura のファイルを読み書きできる（act-as-user）
- SP がアクセスできるのはそのユーザー自身の領域だけで、権限はユーザー本人と同じ
- ユーザーは自分の token を SP に渡すことで委譲する。token の種類は未確定（長時間の処理でも切れない offline token を第一候補とし、実測で確定する）

## quota

- 各ユーザーの領域には容量上限（quota）がある。default は 1 TB で、admin がユーザー単位に変更できる
- quota を超過すると新規の upload が拒否される（403）。download と削除は引き続き行え、容量を quota 内に戻せば upload を再開できる（超過時挙動の詳細は実測で確定する）

## 全ファイル TTL

- デプロイ設定として、全ファイルの TTL（例: 30 日で自動削除）を有効化できる。default は無効
- TTL はファイル作成時刻を基準とし、public 化されたファイルを含む全ファイルに適用される
- 失効前の警告通知は行わない。ファイル単位の TTL 変更（override）もできない
- UI には各ファイルの有効期限（作成時刻 + TTL）を表示する

## ファイル名の制約

- ファイル名に space と `%` は使えない（公開 URL の encoding 問題を避けるため）
- 制約の緩和は未確定。配信経路の encoding 検証で問題ないと確認できた場合のみ緩和する

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
