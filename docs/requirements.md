# 要求仕様

kura は、DDBJ account で認証したユーザーが、自分専用の領域に大容量ファイル（100 GB クラス）を置いて読み書きするためのストレージ基盤である。同じ領域には、ブラウザ、CLI、ユーザーが権限を委譲した外部サービス（SP）のどれからでもアクセスでき、どの経路でも権限はユーザー本人と同じである。kura はオンプレミスに設置し、BSI のサービスとして提供する。

この文書は、kura が利用者に約束することを定める。約束を実現する手段は [architecture.md](./architecture.md) にある。

## ユースケース

kura が提供するのは次の 3 つだけである。

1. 認証したユーザーが、自分の領域にファイルを upload する
2. 認証したユーザーが、自分のファイルを一覧・download・削除する
3. 短期の受け渡しのために presigned URL を発行する

利用者はブラウザに限らない。CLI（aws cli などの S3 client）からも、ブラウザと同じ操作ができる。SP（例: Sapporo WES）がユーザーに代わって、人の操作なしでプログラムからファイルを読み書きする使い方も、ブラウザからの利用と同じく主要な使い方である。

kura のファイルにアクセスできるのは、本人と、本人が明示的に権限を委譲した相手だけである。kura は、認証していない第三者に向けてファイルを配信する経路（public 公開）を持たない（[Non-goals](#non-goals)）。

## 認証と利用者

ユーザーは DDBJ account（Keycloak）の OIDC で認証する。kura は独自のアカウントを持たず、DDBJ account を持つユーザーは誰でも kura を利用できる。kura はユーザーを DDBJ account の username（`preferred_username` claim）で識別する。

admin は、全ユーザーの領域を操作できる。admin が使う手段は CLI（S3 client）と運用スクリプトの 2 つだけで、kura は admin 向けの UI を提供しない。admin として扱う DDBJ account は、配備の設定（環境ごとの env）に列挙する。

## ファイル領域

各ユーザーは自分専用の領域を持ち、領域の中に任意のディレクトリ構造でファイルを置ける。ファイルは `<user>/<path>` で識別する。ユーザーは、他のユーザーの領域の読み書きも一覧もできない。領域は、ユーザーが kura を初めて使うときに client（SPA または S3 client）が作るので、事前の申請や作成の手続きは要らない。

username が S3 bucket の命名規則に合わないユーザー（`_` を含む、`-` で終わる、など）は kura を利用できない。

各領域には容量の上限（quota）がある。quota の既定値は 1 TiB で、admin がユーザー単位に変更できる。

- 使用量が quota を超えると、新規の upload がエラーで拒否される。超えてから拒否が始まるまでに、1 分程度かかる
- quota を超えている間も、download と削除はできる。削除して使用量が quota 内に戻れば、upload を再開できる。ただし、ストレージの再整理を待つので、upload を再開できるようになるまでに遅れが出ることがある

UI は使用量と上限をメーターで表示する。メーターに出す上限は、配備の設定にある quota の既定値である。admin がユーザー単位に変更した quota は、メーターに反映されない。

## upload

ユーザーは、ブラウザまたは S3 client から、100 GB クラスのファイルを upload できる。1 時間を超える upload も、途中で止まらずに続く。中断した upload は、続きから再開（レジューム）できる。認証セッションを取り直したあとでも、再開できる。

## download・一覧・削除

認証したユーザーは、自分のファイルを一覧・download・削除できる。

ユーザーは、複数のファイルやディレクトリを 1 つの zip にまとめて download できる。UI は zip をブラウザの中で組み立てるので、ファイルの中身はブラウザとストレージの間で直接やり取りされる。

- zip の合計が 2 GB 以下なら、ユーザーは通常の download として zip を受け取れる
- zip の合計が 2 GB を超えるときは、UI は zip 全体をメモリに載せずにファイルへ直接書き出す。そのため、ユーザーは先にブラウザで保存先のファイルを選ぶ。保存先のファイルを選ぶ機能を持たないブラウザでは、UI は 2 GB を超える zip の download を受け付けない
- 大容量をまとめて取得するときは、ユーザーは S3 client（CLI）を使う

削除は、即時の完全な消去である。kura はゴミ箱も、復旧のための猶予も設けない。

## presigned URL

ユーザーは、自分のファイルの presigned URL（GET / PUT）を発行できる。presigned URL は、認証していない相手にファイルを渡す、または相手からファイルを受け取るための、短期の受け渡し専用の手段である。

presigned URL の有効期間の上限は 12 時間である。有効期間は、ユーザーがログインしてからの経過時間に左右されない。ユーザーが発行したあとにログアウトしても、URL は期限まで使える。発行した URL を期限の前に無効にする手段は無い（[architecture.md](./architecture.md) の「presigned URL と一時 credentials の有効期間」）。

presigned URL は、client が署名を計算して作る。kura に presigned URL の発行 API は無い。一時 credentials は、ユーザーが access token と引き換えに STS から受け取る、期限付きの S3 の credentials である。一時 credentials を持つ者は誰でも presigned URL を作れるので、kura には presigned URL の発行を禁止する手段が無い。UI は、S3 client でできることの見本（reference）として、発行の操作を提供する。

## SP による非対話利用

SP（例: Sapporo WES）は、ユーザーに代わって、人の操作なしで kura のファイルを読み書きできる。この方式を act-as-user と呼ぶ。SP がアクセスできるのは、そのユーザー自身の領域だけで、SP の権限はユーザー本人と同じである。

ユーザーは、自分の token を SP に渡して、SP に権限を委譲する。長時間の処理では、SP は offline token を使う。SP は offline token で access token を取り直し続け、取り直した access token で一時 credentials を再取得する。offline token は、30 日使われないと失効する。

## 保持期間（TTL）

配備の設定で、全ファイルの TTL（例: 作成から 30 日で自動削除）を有効にできる。既定では TTL は無効である。

- TTL はファイルの作成時刻から数え、全ファイルに同じ値を使う
- kura は失効前の警告を通知しない。ファイル単位に TTL を変更する手段も無い
- UI は、各ファイルの有効期限（作成時刻 + TTL）を表示する

## ファイル名の制約

kura はファイル名に独自の制約を設けない。S3 の object key として有効な名前であれば、space・`%`・`?`・`#`・日本語などを含む名前も使える。

## 監査

kura は、誰がいつどのファイルを操作したか（upload / download / 削除）の記録を残す。kura はすべてのファイル操作を S3 API の request として受けるので、記録には、kura の前段にある gateway の access log を使う。

## UI（reference SPA）

kura は、ブラウザ向けの UI を日本語と英語で提供する。UI は kura の使い方の見本（reference）である。UI を使わなくても、ユーザーは CLI などで kura の全機能を利用できる。

## 非機能要件

- 対象のファイルサイズ: 100 GB クラス
- ファイルの byte は、client（ブラウザまたは S3 client）とストレージの間で直接やり取りする。経路上に kura 独自の server は置かない
- 設置先: オンプレミス。UI と S3 API は、それぞれ別の subdomain で公開する

## Non-goals

kura は次のものを扱わない。必要になったときは、kura の外の別のサービスとして検討する。

- 認証していない第三者へのファイルの配信（public 公開）。kura は本人と、本人が権限を委譲した相手のための領域であり、一般に向けてファイルを配信する経路を持たない。一般に配信するファイルは、配信を行う別のサービスに置く
- 12 時間を超える共有。共有の手段は presigned URL だけで、presigned URL の有効期間の上限（12 時間）を超えて共有する仕組みは持たない
- GA4GH DRS / Passport、controlled access
- versioning
- メタデータ管理、checksum 検証、virus scan
- HTTP/3、Aspera
