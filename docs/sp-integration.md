# SP 向け利用ガイド

公開中の kura に外部サービス（SP）を接続するために必要なことをまとめる。読者は SP 側の管理者と開発者である。この文書だけを読めば接続まで進めるように書いてあり、kura の内部設計を読む必要は無い。

kura は、DDBJ account で認証したユーザーが、自分専用の領域に大容量ファイル（100 GB クラス）を置いて読み書きするためのストレージ基盤である。kura の API は S3 互換である。ユーザー本人のブラウザ、CLI、ユーザーが権限を委譲した SP のどれからでも、同じ領域に同じ権限でアクセスできる。kura は現在 beta 公開（sandbox）であり、後述のとおりデータのバックアップを取らない。

作業ごとの担当は次のとおりである。SP 側だけで完結する作業と、kura の管理者への依頼が要る作業がある。

| 作業 | 誰が行うか |
| --- | --- |
| SP の Keycloak client に audience mapper を足す | SP 側（DDBJ account の realm の管理者への依頼になる場合がある） |
| S3 client の実装、CLI での利用 | SP 側。kura への申請は要らない |
| ユーザーの領域（bucket）の作成 | S3 client が初回に作る。申請は要らない |
| quota の変更、admin 操作、username が bucket 名に使えないユーザーの相談、障害の連絡 | kura の管理者 |

## アクセス先

| 用途 | production | staging（接続テスト用） |
| --- | --- | --- |
| UI（reference SPA） | `https://kura.ddbj.nig.ac.jp` | `https://kura-staging.ddbj.nig.ac.jp` |
| S3 API / STS | `https://kura-s3.ddbj.nig.ac.jp` | `https://kura-s3-staging.ddbj.nig.ac.jp` |
| 認証（DDBJ account） | `https://idp.ddbj.nig.ac.jp/realms/master` | `https://idp-staging.ddbj.nig.ac.jp/realms/master` |

kura 自身の Keycloak client id は、どちらの環境でも `kura` である。

接続テストは staging で行う。staging の kura は、DDBJ account の staging（上の表の `idp-staging` の realm）で認証する。そのため SP は、staging の realm にある自分の client に audience mapper を足すだけでよく（「Keycloak client の設定」）、production の DDBJ account の設定を変える必要は無い。staging のユーザーとファイルは production とは別である。以下の例は production の URL で書いてあるので、staging では上の表の URL に置き換える。

S3 API と STS は同じ endpoint で提供する。region には `us-east-1` を指定する（値に意味は無いが、署名の計算に要る）。疎通は、認証なしで確認できる。

```sh
curl -i https://kura-s3.ddbj.nig.ac.jp/healthz
```

UI は kura の使い方の reference 実装（見本）であり、ブラウザから upload・download・一覧・削除・presigned URL の発行ができる。UI でできることは、すべて S3 API でもできる。kura には UI 専用の機能も、独自の REST API も無い。

## kura のデータモデルと制約

接続の前に、次のことを把握しておく必要がある。

領域は 1 つの bucket である。bucket 名は DDBJ account の username（access token の `preferred_username` claim）と同じである。ファイル `<user>/<path>` は、bucket `<user>` の中の object `<path>` として保存される。ユーザーは自分の bucket だけを読み書きでき、他人の bucket の読み・書き・一覧はすべて拒否される。

bucket は S3 client が作る。初回の upload の前に `HeadBucket` で bucket があるかを確かめ、無ければ `CreateBucket` を実行する。kura 側での申請や事前登録は要らない。`CreateBucket` に Object Lock を指定しない。Object Lock を指定すると、bucket の versioning が有効になる。versioning が有効な bucket では、削除や上書きをする前の中身（古い version）が残り、quota に数えられる。古い version は kura の日次処理が消すので、残るのは最長 1 日である。

username が S3 の bucket 命名規則に合わないユーザーは、kura を利用できない。DDBJ account の username のうち、`_` を含むもの、`-` で終わるもの、3 文字未満のものが該当する。kura は username を変換しない。該当するユーザーが SP の利用対象に含まれる場合は、kura の管理者に相談する。

容量の上限（quota）は、1 ユーザーあたり 1 TiB である。

- 使用量が quota を超えると bucket が read-only になり、新規の upload が HTTP 403（`AccessDenied`）で拒否される。quota の超過の判定が反映されるまでに、1 分程度かかる
- quota を超えても、download と削除はできる。削除して上限内に戻せば、upload を再開できる
- ユーザー単位の quota の変更は、kura の管理者が行う

presigned URL の有効期間は最長 12 時間で、ログインからの経過時間には関係しない（有効期間の決まり方は「S3 client（aws cli）から使う」の補足）。発行した URL を期限の前に無効にする手段は無い。kura には 12 時間を超える共有手段は無い。

kura には、認証していない第三者に向けてファイルを公開する機能（public 公開）は無い。kura の外の相手にファイルを渡す手段は、presigned URL だけである。

削除は即時の完全な消去で、ゴミ箱も復旧の猶予も無い。kura はバックアップも取らない。必要なデータは SP 側にも持っておく。

環境の設定によっては、作成から一定の日数を過ぎたファイルが自動で削除される（全ファイル TTL）。

操作の記録（誰がいつ何を upload / download / 削除したか）は、kura の前段にある gateway の access log で取る。access log の path には bucket 名（= username）が残るので、SP がユーザーに代わって行った操作も、そのユーザーの操作として記録される。

## S3 client（aws cli）から使う

S3 client からの利用は、次の 3 段階である。以下は aws cli v2 の例だが、どの S3 client でも流れは同じである。

1. DDBJ account の access token を得る
2. STS で access token を一時 credentials に交換する
3. 一時 credentials で S3 API を呼ぶ

### 1. access token を得る

kura の Keycloak client は device flow（RFC 8628）に対応している。device flow を使えば、ブラウザを持たないホスト（計算ノード、ssh 先、コンテナの中）でも access token を取れる。kura の client は PKCE を強制するので、device authorization request にも `code_challenge` を付ける。

```sh
export ISSUER=https://idp.ddbj.nig.ac.jp/realms/master

VERIFIER=$(openssl rand -base64 60 | tr -d '\n=+/' | cut -c1-64)
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr -d '\n=' | tr '+/' '-_')

RESP=$(curl -s -X POST "$ISSUER/protocol/openid-connect/auth/device" \
  -d client_id=kura -d scope=openid \
  -d code_challenge="$CHALLENGE" -d code_challenge_method=S256)

echo "$RESP" | python3 -m json.tool
```

応答の `verification_uri_complete` を任意の端末のブラウザで開き、DDBJ account でログインして承認する。承認できるのは、device authorization request から 10 分の間である。承認したら token を受け取る。

```sh
DEVICE_CODE=$(echo "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["device_code"])')

export ACCESS_TOKEN=$(curl -s -X POST "$ISSUER/protocol/openid-connect/token" \
  -d grant_type=urn:ietf:params:oauth:grant-type:device_code \
  -d client_id=kura -d device_code="$DEVICE_CODE" -d code_verifier="$VERIFIER" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
```

承認の前に token を要求すると、`authorization_pending` が返る。その場合は 5 秒以上あけて再試行する。kura の client の access token は 5 分で切れるので、受け取ったらすぐに次の手順で一時 credentials に交換する。一時 credentials の有効期間は、access token の有効期間に関係しない。

長時間のジョブで access token を取り直し続けたい場合は、device authorization request の `scope` に `offline_access` を足し、token の応答の `refresh_token`（offline token）を保管する。offline token の使い方は「ユーザーからの委譲」と同じである。kura の client で取った offline token は 7 日で切れ、offline token で access token を取り直しても 7 日の期限は延びない。offline token が切れたら、device flow からやり直す。

UI にログイン済みなら、ブラウザの開発者ツールのコンソールから access token を取り出すこともできる。この方法は一時的な確認のためのものである。token は本人の資格情報そのものなので、他人と共有しない。

```js
JSON.parse(sessionStorage["oidc.user:https://idp.ddbj.nig.ac.jp/realms/master:kura"]).access_token
```

SP の実装で使う access token は、SP 自身の Keycloak client から得る（「SP がユーザーに代わって使う」）。その場合、SP の client に audience mapper が要る。

token の中身は次のコマンドで確認できる。`aud` に `kura`（SP の client 経由なら `kura` を含む配列）が、`preferred_username` に username が入っていれば、その token は kura で使える。

```sh
python3 -c 'import base64,json,sys; p=sys.argv[1].split(".")[1]; print(json.dumps(json.loads(base64.urlsafe_b64decode(p+"="*(-len(p)%4))), indent=2))' "$ACCESS_TOKEN"
```

### 2. 一時 credentials に交換する

```sh
export AWS_DEFAULT_REGION=us-east-1
export KURA_S3=https://kura-s3.ddbj.nig.ac.jp

eval "$(aws sts assume-role-with-web-identity \
  --endpoint-url "$KURA_S3" \
  --role-arn arn:aws:iam::role/KuraUserRole \
  --role-session-name kura-cli \
  --web-identity-token "$ACCESS_TOKEN" \
  --duration-seconds 43200 \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text \
  | awk '{print "export AWS_ACCESS_KEY_ID="$1"\nexport AWS_SECRET_ACCESS_KEY="$2"\nexport AWS_SESSION_TOKEN="$3}')"
```

この呼び出しに credentials は要らない（認証は web identity token で行う）。`--duration-seconds` には 900（15 分）から 43200（12 時間）までを指定でき、STS はその長さの一時 credentials を返す。一時 credentials の長さは、access token の残り時間に関係しない。

### 3. S3 API を使う

bucket が未作成なら、最初に 1 度だけ作る。bucket 名は自分の username である。

```sh
export KURA_BUCKET=<username>
aws s3api head-bucket --endpoint-url "$KURA_S3" --bucket "$KURA_BUCKET" \
  || aws s3api create-bucket --endpoint-url "$KURA_S3" --bucket "$KURA_BUCKET"
```

以降は、通常の S3 の操作である。

```sh
aws s3 cp ./big.bin "s3://$KURA_BUCKET/demo/big.bin" --endpoint-url "$KURA_S3"
aws s3 ls "s3://$KURA_BUCKET/demo/" --endpoint-url "$KURA_S3"
aws s3 sync ./dir "s3://$KURA_BUCKET/demo/dir" --endpoint-url "$KURA_S3"
aws s3 rm "s3://$KURA_BUCKET/demo/big.bin" --endpoint-url "$KURA_S3"
aws s3 presign "s3://$KURA_BUCKET/demo/big.bin" --expires-in 900 --endpoint-url "$KURA_S3"
```

毎回 `--endpoint-url` を渡す代わりに、`~/.aws/config` の profile に書いてもよい。

```ini
[profile kura]
region = us-east-1
endpoint_url = https://kura-s3.ddbj.nig.ac.jp
```

補足:

- addressing style は既定のままでよい。aws cli は、独自の endpoint を指定すると path style で送る。virtual-host style が既定の SDK では、path style を明示する（AWS SDK for JavaScript / Go なら `forcePathStyle` に当たる設定）
- checksum の設定も既定のままでよい。新しい aws cli が既定で付ける追加の checksum を、kura はそのまま受け付ける
- 100 GB クラスのファイルも、既定の設定で転送できる。aws cli は、part 数の上限に合わせて part のサイズを自動で調整する。転送を速くしたい場合は、`s3.multipart_chunksize` を大きくする
- 長い転送では、一時 credentials の残り時間に注意する。一時 credentials は `--duration-seconds` で指定した時間（最大 12 時間）で失効し、失効すると転送は途中で止まる。aws cli には再開の機能が無いので、失効した場合は credentials を取り直して同じコマンドを再実行する（未完了の part は、kura の日次処理が削除する）
- ブラウザの UI からの upload は、UI が credentials を自動で取り直すので、失効で止まらない。UI は中断からの再開にも対応している
- presigned URL の有効期間は、`--expires-in` の値と、一時 credentials の残り時間の短いほうになる
- ファイルを消しても、親フォルダを表す object が残ることがある。`aws s3 rm` は指定した object を消すだけなので、`dir/` のような key の object が、`aws s3 ls` では 0 byte の行として、UI では空のフォルダとして残る。消すには、末尾にスラッシュを付けた key を削除する（`aws s3api delete-object --bucket <username> --key 'dir/'`）

### エラーの読み方

| 症状 | 原因 |
| --- | --- |
| STS が `InvalidParameterValue ... token audience matches none of the configured client IDs` | token の `aud` にも `azp` にも `kura` が入っていない。SP の client なら audience mapper が要る |
| STS は通るが、あらゆる S3 操作が `AccessDenied` | access token に `preferred_username` が入っていない。または、他人の bucket にアクセスしている |
| `InvalidAccessKeyId: The access key ID you provided does not exist in our records` | 一時 credentials が失効した。STS からやり直す |
| download と削除はできるのに、upload だけが `AccessDenied` で失敗する | quota を超えている。不要なファイルを削除するか、kura の管理者に上限の変更を相談する |
| `NoSuchBucket` | 自分の bucket をまだ作っていない（`CreateBucket` を 1 度だけ実行する） |

## SP がユーザーに代わって使う

kura は act-as-user 方式を採る。act-as-user 方式では、SP はユーザーの token を使う client として、ユーザー本人と同じ権限（そのユーザーの bucket だけ）で読み書きする。kura には、SP を登録する仕組みも、SP 専用の権限も無い。

したがって、次のことが成り立つ。

- SP がアクセスできるのは、token を渡したユーザー自身の領域だけである
- SP の service account（client credentials）では kura を利用できない。service account は、bucket 名になる username を持たないためである
- DDBJ account を持たない利用者に代わって kura を使うことはできない
- kura には、どの SP が委譲を受けているかの情報は無い。委譲の情報は SP と Keycloak にあり、SP と Keycloak の側で管理する

### Keycloak client の設定

SP が自分の Keycloak client で発行した access token を kura に渡すには、SP の client が次の設定を満たす必要がある。realm 全体の設定と kura の client は変更しない。

| 設定 | 値 | 必須か | 理由 |
| --- | --- | --- | --- |
| dedicated scope の Audience mapper | Included Client Audience = `kura`、Add to access token = ON | 必須 | kura は、token の `aud`（`aud` が無ければ `azp`）が `kura` と一致することを検証する。SP の client id を kura 側に登録する仕組みは無い |
| access token に `preferred_username` を入れる | dedicated scope の User Attribute mapper（`username`）、または `profile` scope | 必須 | bucket 名は `preferred_username` claim から決まる。lightweight access token などで `preferred_username` が token に入らないと、STS は通るのに S3 の操作がすべて拒否される |
| access token に email と氏名を入れない | `profile` と `email` を default client scope から外し、`preferred_username` は dedicated scope の mapper で入れる | 推奨 | kura の STS は access token の claim を session token に書き込み、session token は presigned URL に載る。email と氏名を入れると、URL を渡した相手に email と氏名が渡る |
| `offline_access` を optional client scope に追加する | — | 長時間の処理をするなら必須 | 非対話で access token を取り直し続けるために使う |
| Access Token Lifespan | 短くてよい（例: 5 分） | 任意 | 一時 credentials と presigned URL の有効期間は、STS に要求した `DurationSeconds` で決まり、token の有効期間には関係しない |

Keycloak の管理コンソールでは、Clients → 対象の client → Client scopes → `<client-id>-dedicated` → Add mapper → By configuration → Audience から追加する。設定したあとに発行した token をデコードし、`aud` に `kura` が含まれることと、`preferred_username` が入っていることを確認する。

### ユーザーからの委譲

短時間の処理なら、SP はユーザーの access token をそのまま受け取って使えばよい。1 時間を超える処理や、ユーザーがブラウザを閉じたあとも続く処理には、offline token を使う。

1. SP がユーザーを認証するとき、scope に `offline_access` を加える（Authorization Code + PKCE）
2. 得られた refresh token（Offline 型）を SP が保管する。offline token の期限は SP の client の設定に従う。realm の既定では期限は無く、30 日間使われないと失効する
3. 必要になるたびに、SP は refresh token から access token を取り直す

   ```sh
   curl -s -X POST "https://idp.ddbj.nig.ac.jp/realms/master/protocol/openid-connect/token" \
     -d grant_type=refresh_token \
     -d client_id="<sp-client-id>" \
     -d refresh_token="$OFFLINE_TOKEN"
   ```

4. SP は、得た access token で STS を呼び、一時 credentials で S3 API を呼ぶ（「S3 client（aws cli）から使う」の 2 以降と同じ）

offline token を持つ者は、そのユーザーとして kura を読み書きできる。SP は offline token を安全に保管する。また、ユーザーが委譲を解除する手段をユーザーに案内する。委譲は、DDBJ account の account console で offline session を revoke すると解除できる。

### ブラウザから直接使う場合

SP の frontend が、ユーザーのブラウザから kura へ直接 upload / download することもできる。ブラウザから直接使うと、ファイルの byte が SP のサーバを経由しないので、大容量のファイルを扱うならこの方法が望ましい。

kura の S3 API は、すべての origin からの CORS を許可しているので、kura 側に origin を登録する作業は要らない。kura の認可は SigV4 署名（一時 credentials を持っていること）だけで決まり、kura は origin で認可を判断しないためである。SP 側では、自分の Keycloak client に、frontend の URL を redirect URI と web origins として登録する。

ブラウザから S3 API を直接呼ぶ実装の例としては、kura の reference SPA（`app/lib/s3/`）がそのまま参考になる。reference SPA は、multipart upload、中断からの再開、presigned URL の発行までを、S3 API と STS だけで実装している。
