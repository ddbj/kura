# SP 向け利用ガイド

公開中の kura に外部サービス（SP）を接続するために必要なことをまとめる。読者は SP 側の管理者と開発者で、この文書だけで接続まで到達できるように書いてある。kura の内部設計を読む必要はない。

kura は、DDBJ account で認証したユーザーが自分専用の領域に大容量ファイル（100 GB クラス）を置いて読み書きできるストレージ基盤である。実体は S3 互換の API で、ユーザー本人のブラウザからも、CLI からも、ユーザーが権限を委譲した SP からも、同じ領域に同じ権限でアクセスする。現在は beta 公開（sandbox）であり、後述のとおりデータのバックアップは行わない。

SP 側だけで完結する作業と、kura の管理者への依頼が要る作業は次のように分かれる。

| 作業 | 誰が行うか |
| --- | --- |
| SP の Keycloak client に audience mapper を足す | SP 側（realm の管理者への依頼になる場合がある） |
| S3 client の実装、CLI での利用 | SP 側。kura への申請は要らない |
| ユーザーの領域（bucket）の作成 | client が自動で行う。申請は要らない |
| quota の変更、admin 操作、username が使えないユーザーの相談、障害連絡 | kura の管理者 |

## アクセス先

| 用途 | URL |
| --- | --- |
| UI（reference SPA） | `https://kura.ddbj.nig.ac.jp` |
| S3 API / STS | `https://kura-s3.ddbj.nig.ac.jp` |
| 認証（DDBJ account） | `https://idp.ddbj.nig.ac.jp/realms/master`（kura 自身の client id は `kura`） |

S3 API と STS は同じ endpoint で提供する。region は `us-east-1` を指定する（値に意味は無いが署名の計算に要る）。疎通は認証なしで確認できる。

```sh
curl -i https://kura-s3.ddbj.nig.ac.jp/healthz
```

UI は「kura の使い方の reference 実装」であり、ブラウザから upload・download・一覧・削除・presigned URL の発行ができる。UI でできることはすべて S3 API でもできる。kura には UI 専用の機能も、独自の REST API も無い。

## kura のデータモデルと制約

接続の前にこれだけは把握しておく必要がある。

**領域は bucket そのもの**である。bucket 名は DDBJ account の username（access token の `preferred_username` claim）と等しく、ファイル `<user>/<path>` の実体は bucket `<user>` の object `<path>` になる。ユーザーは自分の bucket だけを読み書きでき、他人の bucket は読み・書き・一覧のすべてが拒否される。

**bucket は client が作る。** 初回の upload の前に `HeadBucket` で存在を確かめ、無ければ `CreateBucket` する。kura 側での申請や事前登録は要らない。

**username が S3 の bucket 命名規則に合わないユーザーは kura を利用できない。** DDBJ account の username のうち `_` を含むもの、`-` で終わるもの、3 文字未満のものが該当する。変換による救済はしていないので、該当するユーザーが利用対象に含まれる場合は kura の管理者に相談する。

**容量上限（quota）は 1 ユーザーあたり 1 TiB** である。超過すると bucket が read-only になり、新規の upload が HTTP 500 で拒否される（判定の反映には 1 分程度かかる）。download と削除は引き続き行え、削除して上限内に戻せば upload を再開できる。ユーザー単位の変更は kura の管理者が行う。

**presigned URL の有効期間は最長 12 時間**だが、実際には発行時点の認証セッションの残り時間で頭打ちになる。DDBJ account の SSO セッションは最大 10 時間なので、発行できる URL の寿命はログインからの経過とともに縮む。12 時間を超える共有手段は kura には無い。

**認証を持たない第三者への配信経路は持たない。** public 公開の機能は存在せず、presigned URL が唯一の対外的な受け渡し手段である。

**削除は即時の完全消去**で、ゴミ箱も復旧猶予も無い。**バックアップも行わない。** 必要なデータは SP 側にも持っておく。

**全ファイル TTL** は deployment 設定で有効にできる機能で、現在の公開環境では無効にしている。有効化する場合は事前に周知する。

操作の記録（誰がいつ何を upload / download / 削除したか）は kura の前段にある gateway の access log で取得する。記録は bucket 所有者に帰属するため、SP がユーザーに代わって行った操作も、そのユーザーの操作として記録される。

## S3 client（aws cli）から使う

流れは「DDBJ account の access token を得る」→「STS で一時 credentials に交換する」→「S3 API を叩く」の 3 段である。以下は aws cli v2 の例だが、どの S3 client でも同じである。

### 1. access token を得る

kura の Keycloak client は device flow（RFC 8628）に対応している。ブラウザを持たないホスト（計算ノード、ssh 先、コンテナの中）でもこれで取れる。client は PKCE を強制するので、device authorization request にも `code_challenge` を付ける。

```sh
export ISSUER=https://idp.ddbj.nig.ac.jp/realms/master

VERIFIER=$(openssl rand -base64 60 | tr -d '\n=+/' | cut -c1-64)
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr -d '\n=' | tr '+/' '-_')

RESP=$(curl -s -X POST "$ISSUER/protocol/openid-connect/auth/device" \
  -d client_id=kura -d scope=openid \
  -d code_challenge="$CHALLENGE" -d code_challenge_method=S256)

echo "$RESP" | python3 -m json.tool
```

応答の `verification_uri_complete` を任意の端末のブラウザで開き、DDBJ account でログインして承認する（有効時間は 10 分）。承認したら token を受け取る。

```sh
DEVICE_CODE=$(echo "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["device_code"])')

export ACCESS_TOKEN=$(curl -s -X POST "$ISSUER/protocol/openid-connect/token" \
  -d grant_type=urn:ietf:params:oauth:grant-type:device_code \
  -d client_id=kura -d device_code="$DEVICE_CODE" -d code_verifier="$VERIFIER" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
```

承認前に token を要求すると `authorization_pending` が返る。5 秒以上あけて再試行する。長時間のジョブで token を取り直し続けたい場合は、`scope` に `offline_access` を足して応答の `refresh_token` を保管する（使い方は「ユーザーからの委譲」と同じ）。

UI にログイン済みなら、ブラウザの開発者ツールのコンソールから取り出すこともできる。一時的な確認向けで、token は本人の資格情報そのものなので他人と共有しない。

```js
JSON.parse(sessionStorage["oidc.user:https://idp.ddbj.nig.ac.jp/realms/master:kura"]).access_token
```

SP の実装として使う場合は、SP 自身の Keycloak client から得る（「SP がユーザーに代わって使う」を参照）。その場合は client に audience mapper が要る。

token の中身は次で確認できる。`aud` に `kura`（または SP の client 経由なら `kura` を含む配列）、`preferred_username` に username が入っていれば kura で使える。

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

この呼び出しに credentials は要らない（認証は web identity token で行う）。`--duration-seconds` に何を指定しても、実際のセッション長は access token の残り有効期間で頭打ちになる。返り値の `Expiration` が実効値である。

### 3. S3 API を叩く

bucket が未作成なら最初に 1 度だけ作る。bucket 名は自分の username である。

```sh
export KURA_BUCKET=<username>
aws s3api head-bucket --endpoint-url "$KURA_S3" --bucket "$KURA_BUCKET" \
  || aws s3api create-bucket --endpoint-url "$KURA_S3" --bucket "$KURA_BUCKET"
```

以降は通常の S3 操作である。

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

いくつか補足がある。

- **addressing style は既定のままでよい。** aws cli は独自 endpoint を指定すると path style で送る。ただし SDK によっては virtual-host style が既定なので、その場合は path style を明示する（AWS SDK for JavaScript / Go なら `forcePathStyle` 相当）
- **checksum の設定も既定のままでよい。** 新しい aws cli が既定で付ける追加 checksum はそのまま受け付ける
- **100 GB クラスのファイルも既定の設定で通る。** aws cli は part 数の上限に合わせて part サイズを自動で調整する。転送を速くしたい場合は `s3.multipart_chunksize` を大きくする
- **長い転送はセッションの残り時間に注意する。** 一時 credentials はログインから最大 10 時間で失効し、失効すると転送は途中で止まる。aws cli には再開の機能が無いので、失効した場合は credentials を取り直して同じコマンドを再実行する（未完了の part は kura 側の日次処理が回収する）。ブラウザ UI からの upload は失効を自動で回避し、中断からの再開にも対応している
- presigned URL の寿命は `--expires-in` の値と、一時 credentials の残り時間の小さい方になる

### エラーの読み方

| 症状 | 原因 |
| --- | --- |
| STS が `InvalidParameterValue ... token audience matches none of the configured client IDs` | token の `aud` にも `azp` にも `kura` が入っていない。SP の client なら audience mapper が要る |
| STS は通るが、あらゆる S3 操作が `AccessDenied` | access token に `preferred_username` が入っていない。または他人の bucket を触っている |
| `InvalidAccessKeyId: The access key ID you provided does not exist in our records` | 一時 credentials が失効した。STS からやり直す |
| upload だけが HTTP 500 で失敗する | quota 超過。不要なファイルを削除するか、kura の管理者に上限の変更を相談する |
| `NoSuchBucket` | 自分の bucket をまだ作っていない（`CreateBucket` を 1 度だけ行う） |

## SP がユーザーに代わって使う

kura は **act-as-user** 方式を採る。SP は「ユーザーの token を預かった client」として振る舞い、ユーザー本人と同じ権限（そのユーザーの bucket だけ）で読み書きする。kura 側に SP を登録する仕組みも、SP 専用の権限も存在しない。

したがって次が成り立つ。

- SP が触れるのは、token を預けたユーザー自身の領域だけである
- SP の service account（client credentials）では利用できない。bucket 名になる username を持たないためである
- DDBJ account を持たない利用者に代わって使うことはできない
- kura 側に「どの SP が委譲を受けているか」の情報は無い。委譲の管理は SP と Keycloak の責務である

### Keycloak client の設定

SP が自分の Keycloak client で発行した access token を kura に渡すには、その client の設定が次を満たす必要がある。realm 全体の設定や kura の client には手を入れない。

| 設定 | 値 | 必須か | 理由 |
| --- | --- | --- | --- |
| dedicated scope の Audience mapper | Included Client Audience = `kura`、Add to access token = ON | 必須 | kura は token の `aud`（無ければ `azp`）が `kura` と一致することを検証する。SP の client id を kura 側に登録する仕組みは無い |
| `profile` を default client scope に残す | — | 必須 | bucket 名は `preferred_username` claim から決まる。lightweight access token などで claim が落ちると、STS は通るのに S3 がすべて拒否される |
| `offline_access` を optional client scope に追加 | — | 長時間処理をするなら必須 | 非対話で access token を取り直し続けるために使う |
| Access Token Lifespan の client override | 任意（例: 12 時間） | 任意 | 一時 credentials と presigned URL の寿命は token の残り時間で決まる。ただし SSO セッション（最大 10 時間）が天井になる |

Keycloak の管理コンソールでは、Clients → 対象の client → Client scopes → `<client-id>-dedicated` → Add mapper → By configuration → Audience から追加する。設定後に発行した token をデコードし、`aud` に `kura` が含まれること、`preferred_username` が入っていることを確認する。

### ユーザーからの委譲

短時間の処理なら、ユーザーの access token をそのまま受け取って使えばよい。1 時間を超える処理や、ユーザーがブラウザを閉じたあとも続く処理には offline token を使う。

1. SP がユーザーを認証するとき、scope に `offline_access` を加える（Authorization Code + PKCE）
2. 得られた refresh token（Offline 型。期限は無く、30 日間使われないと失効する）を SP が保管する
3. 必要になるたびに refresh token から access token を取り直す

   ```sh
   curl -s -X POST "https://idp.ddbj.nig.ac.jp/realms/master/protocol/openid-connect/token" \
     -d grant_type=refresh_token \
     -d client_id="<sp-client-id>" \
     -d refresh_token="$OFFLINE_TOKEN"
   ```

4. 得た access token で STS を呼び、一時 credentials で S3 を叩く（「S3 client から使う」の 2 以降と同じ）

offline token は「そのユーザーとして kura を読み書きできる鍵」そのものである。SP 側で安全に保管し、ユーザーが委譲を解除する手段（DDBJ account の account console からの offline session の revoke）を案内する。

### ブラウザから直接使う場合

SP の frontend が、ユーザーのブラウザから kura へ直接 upload / download することもできる。ファイルの byte が SP のサーバを経由しないので、大容量を扱うならこちらが望ましい。

kura の S3 API はすべての origin からの CORS を許可しているので、kura 側に origin を登録する作業は要らない。認可は SigV4 署名（一時 credentials を持っていること）だけで決まり、origin は認可の境界にしていないためである。SP 側では、自分の Keycloak client に frontend の URL を redirect URI と web origins として登録する。

ブラウザから S3 を直接叩く実装例は、kura の reference SPA（`app/lib/s3/`）がそのまま参考になる。multipart upload、中断からの再開、presigned URL の発行までを、S3 API と STS だけで実装している。
