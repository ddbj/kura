# 設計

kura は SeaweedFS（S3 API・STS・IAM）の設定群である。kura は独自の API server や BFF を作らない。作っても S3 API の wrapper にしかならず、ファイルの byte が通る経路を 1 つ増やすだけだからである。SPA は S3 API を直接呼ぶ client の一例（reference 実装）で、kura には SPA の静的ビルドを配信する server が 1 つ付属する。

この文書は、kura が今の形になっている理由を説明する。利用者への約束は [requirements.md](./requirements.md) に、運用の判断は [operations.md](./operations.md) にある。

## 設計の原則

次の原則は kura のすべての部分に当てはまる。どれか 1 つでも破る変更は、設計の変更として扱う。

- ファイルの byte は、client と SeaweedFS の S3 API の間で直接やり取りする。経路上に kura 独自の server は置かない
- S3（SeaweedFS）を SSOT にする。状態はすべて S3 にあり、kura は別の DB を持たない
- SeaweedFS は upstream の公式のものだけを使う。fork も patch も作らず、upstream に無い機能や修正に依存しない
- IAM の policy と roleMapping が参照する JWT claim は、top-level の scalar だけにする。SeaweedFS の policy engine は nested claim を扱えず、配列の claim は STS session を経由すると文字列に変換されるためである
- 認証していない request を受け付ける経路を持たない。例外は SPA の静的 asset の配信だけで、静的 asset の配信にファイルの byte は流れない

## 全体構成

```
+-----------+   OIDC (PKCE)    +---------------+
|  Browser  | <--------------> | DDBJ Keycloak |
|   (SPA)   |                  +---------------+
+-----------+
  |      |
  |      +-- access token --> SeaweedFS STS --> temporary credentials
  |
  +--------- S3 API (SigV4) --> SeaweedFS S3
  |
  +--------- static assets ---> SPA delivery server
```

SeaweedFS は S3 API・STS・IAM・filer を担当し、ファイルの SSOT になる。SPA の配信 server は reference SPA の静的ビルドを配るだけの server で、kura の機能には関与しない。kura の前段には、TLS の終端と subdomain による振り分けを行う gateway がある。gateway は kura の repo の外にあり、他のサービスと共用である。ユーザーは DDBJ account（Keycloak）で認証する。Keycloak には、kura 専用の client が 1 つある。

## データの配置

ユーザーの領域は 1 つの bucket である。bucket 名には username（`preferred_username`）をそのまま使う。ファイル `<user>/<path>` の実体は、bucket `<user>` の中の object `<path>`（filer の path では `/buckets/<user>/<path>`）である。

bucket は client が作る。SPA は一覧画面を開いたときに作り、CLI ではユーザーが初回の upload の前に作る。SeaweedFS では、初回の PUT による bucket の自動作成が admin 権限でしか効かず、STS で認証した一般ユーザーには使えないためである。CreateBucket は、所有者が自分の既存の bucket に対して実行しても 409（`BucketAlreadyExists` / `BucketAlreadyOwnedByYou`）を返す。そのため client は、HeadBucket で bucket があるかを確かめ、無いときだけ CreateBucket を実行する。ユーザーから見れば、初めて使うときに領域が用意されるので、事前の申請は要らない。

kura は username を sanitize せず、そのまま bucket 名にする。SeaweedFS は bucket の作成時に S3 の命名規則を強制する。

- S3 の命名規則: 3-63 文字。使える文字は小文字英数と `.` `-` だけで、先頭と末尾は英数。`..` の連続、IP アドレスの形、`xn--` で始まる名前、`-s3alias` で終わる名前、`filemeta` は拒否される
- DDBJ account の username の規則: 3-24 文字。先頭は小文字英数で、使える文字は `a-z 0-9 _ -`

このため、`_` を含む username と `-` で終わる username のユーザーは、kura を利用できない。kura は username を変換して、こうしたユーザーを利用できるようにすることはしない。username を重複なく bucket 名に変換する処理を、認証の経路（Keycloak が発行する token から IAM policy まで）の上に置けないためである。変換すると、bucket 名が `preferred_username` claim と一致しなくなる。

ファイルツリーには、ユーザーが置いたファイルだけがある。kura は prefix による分類も、目印の object も持たない。例外は 1 つだけで、SPA の「新規フォルダ」操作は 0-byte の `.keep` object を作る。`.keep` は、まだ file を upload していないフォルダを一覧に表示するための object である。`.keep` は SPA の一覧に表示されず、TTL の削除の対象にもならない。

## 認証と認可

一般ユーザーの経路は 3 段階である。

1. SPA（または CLI）が、DDBJ Keycloak で OIDC の認証（Authorization Code + PKCE）を行う。token は client 側が保持する
2. client は、access token を SeaweedFS の STS の `AssumeRoleWithWebIdentity` に渡して、一時 credentials（access key・secret key・session token）を受け取る
3. client は、以後の S3 API の request を一時 credentials で SigV4 署名する

認可の主体は 3 つあり、それぞれアクセスできる範囲が違う。

`KuraUserRole`（一般ユーザー）は、roleMapping の `defaultRole` である。検証を通った access token は、role を指定しなくてもこの role になる。policy は、kura が使う操作の action だけを、bucket `${jwt:preferred_username}` とその中の object に対して Allow する（policy 変数は bucket 名の位置でも展開される）。許可する操作は次のとおりで、一覧は `seaweedfs/entrypoint.sh` にある。

- bucket に対して: 作成、一覧、multipart upload の一覧、location の取得
- object に対して: 読み書き、削除、multipart upload の各操作、tag の読み書き

bucket の設定を変える操作（policy・ACL・CORS・lifecycle・versioning・Object Lock・暗号化・quota など）は Allow に入れない。SeaweedFS は版が上がるたびに操作を増やすので、禁止する操作を並べる形では、新しく増えた操作が禁止から抜ける。許す操作を並べる形なら、新しく増えた操作は既定で拒否される。設定を変える操作を許さないので、ユーザーは自分の bucket の公開範囲を広げられず（bucket policy・ACL）、自分の quota も変えられない。他人の bucket に対しては、read・write・list・作成のすべてが拒否される。

`KuraAdminRole`（admin の CLI 操作）は、全 bucket に対する `s3:*` を持つ。roleMapping はこの role を割り当てないので、`AssumeRoleWithWebIdentity` で `RoleArn` を明示したときにだけ、この role を得られる。trust policy は、token の `oidc:sub` を `KURA_ADMIN_SUBS` に列挙した Keycloak の `sub`（UUID）と照合し、一致しない request を拒否する。`KURA_ADMIN_SUBS` が空のときは、どのユーザーとも一致しない値（番兵値）が trust policy に入り、誰もこの role を assume できない（fail-closed）。admin の判定は trust policy の中で完結するので、Keycloak 側に admin 用の claim も mapper も要らない。

root identity（運用スクリプト）は、s3.json に定義した固定の access key と secret key で、Keycloak も STS も経由しない。root identity を使うのは日次運用タスクだけで、一般ユーザーの経路（Keycloak と STS）からは root identity に到達できない。

trust policy は、role の偽装を拒否する。role の偽装とは、token に対応しない role を指定することである。

SeaweedFS の設定ファイルは 3 つある。

- iam.json: OIDC provider（issuer・clientId・jwksUri）、roleMapping、policy と role の定義、`sts.signingKey` を書く。`sts.maxSessionLength` は 12h にする
- s3.json: root identity だけを書く。anonymous identity は置かない。認証なしで S3 にアクセスできる経路を作らないためである
- security.toml: `jwt.filer_signing.key` と `jwt.filer_signing.read.key` に同じ鍵を書き、filer の HTTP の read・write と IAM の gRPC service に Bearer token を必須にする。filer の API には S3 の IAM が効かない。この鍵が無いと、compose network 上のどのプロセスからでも（SPA の配信 server も同じ network にある）、全 bucket を認証なしで読み書きできる

filer の read 用と write 用で鍵を分けないのは、どちらの鍵も cluster の中だけで使われて client に渡らないので、鍵を 2 本に増やしても脅威モデル上の利点が無いためである。

## presigned URL と一時 credentials の有効期間

presigned URL（GET / PUT）は、client が一時 credentials を使って自分で作る。サーバ側に発行 API は無く、署名の計算は client 側で完結する。したがって kura には、一時 credentials を持つ者が presigned URL を発行するのを禁止する手段が無い。

presigned URL の有効期間は、次の 2 つのうち短いほうになる。

- 署名に入れた `X-Amz-Expires`
- 署名に使った一時 credentials（STS session）の残り時間

STS session の長さは、`AssumeRoleWithWebIdentity` に渡した `DurationSeconds` で決まる。上限は `sts.maxSessionLength`（12 時間）で、`DurationSeconds` を指定しなければ `sts.tokenDuration`（1 時間）になる。STS session の長さは元の access token の有効期限で制限されないので、5 分で切れる access token からも 12 時間の session を作れる。

SPA は、presigned URL を発行するたびに新しい STS session を取り、`DurationSeconds` と `X-Amz-Expires` に同じ値を入れる。UI が提示する有効期間は「15分 / 1時間 / 12時間」で、どれもログインからの経過時間に関係しない。SPA がファイル操作に使う一時 credentials は、`DurationSeconds` を指定せずに取り、切れる前に新しい access token で取り直す。SSO session が切れると SPA は access token を取り直せなくなるので、SSO session が切れた時点で SPA の操作は止まる。

STS session は、発行したあとに revoke できない（AWS の仕様と同じ）。漏れた credentials や、誤った相手に渡した presigned URL は、自然に失効するまで誰でも使え、その期間は最大 12 時間である。presigned URL を受け取った人は、URL の中の session token から secret key を導いて、別の request に署名することはできない。SeaweedFS は secret key を STS の署名鍵から作り、受け取った人は署名鍵を持たないためである。

SeaweedFS は access token の claim を session token に書き込み、session token は presigned URL の `X-Amz-Security-Token` にそのまま載る。そのため、kura の Keycloak client が発行する access token には、認証と認可に使う claim だけを載せる（「Keycloak client」）。

## 委譲（SP の非対話利用）

kura は act-as-user 方式を採る。act-as-user 方式では、SP はユーザーの token で STS から一時 credentials を取り、ユーザー本人と同じ権限（ユーザー自身の bucket だけ）で読み書きする。kura には、SP 専用の実装も権限も無い。

ユーザーは、自分の token を SP に渡して委譲する。長時間の処理では、SP は offline token を使う。SP は、自分の Keycloak client でユーザーを認証するときに `offline_access` を要求し、得た offline token で access token を取り直し続けて、STS を呼び直す。SP の client で取った offline token の期限は、SP の client の設定に従う。kura の client で取った offline token は 7 日で切れる（「Keycloak client」）。

## quota と TTL の実現

quota には、SeaweedFS の native の per-bucket quota（`s3.bucket.quota`）を使う。SeaweedFS は使用量を collection（= bucket）のメトリクスから得るので、kura は自前の容量カウンタを持たない。使用量が quota を超えると、SeaweedFS の quota の enforcement が bucket を read-only にし、write は HTTP 403（AccessDenied）で拒否される。使用量が quota を下回ると、SeaweedFS は read-only を自動で解除する。新しい bucket への既定値の適用は、seaweedfs コンテナの entrypoint の quota reconciler が行う。quota reconciler は、quota が未設定の bucket を見つけて既定値を設定する。

SPA が使用量メーターに出す上限は、ビルド時に埋め込んだ既定値である。bucket の quota の設定値を読む操作は SeaweedFS の S3 拡張にしか無く、一般ユーザーの policy はその操作を許していないためである。admin がユーザー単位に変更した quota は、UI に反映されない。

全ファイルの TTL は、日次運用タスクで実現する。日次運用タスクは、作成時刻に TTL を足した時刻を過ぎた object を削除する。kura は SeaweedFS の volume TTL を使わない。volume TTL では、失効した object が一覧に残ったまま読み出しだけがエラーになる状態が生じるためである。S3 lifecycle も使わない。S3 lifecycle は bucket ごとのルールの適用と worker の運用が必要になるが、結果は単純な日次の削除と変わらないためである。

ユーザーが CLI で Object Lock を有効にして bucket を作ると、その bucket は versioning が有効になり、削除や上書きをしても古い version が残る。CreateBucket は Object Lock の有効化に権限を求めないので、一般ユーザーでもこうした bucket を作れる（「SeaweedFS 由来の制約」）。古い version は quota の使用量に数えられるが、一般ユーザーの policy は version を一覧・削除する操作を許さないので、ユーザーは古い version を消せない。そこで日次運用タスクが、versioning が有効な bucket の古い version と delete marker を、TTL の設定に関係なくすべて削除する。

- 一般ユーザーは versioning を変える操作も許されないので、versioning が有効な bucket は、Object Lock を有効にして作った bucket だけである
- kura は versioning を提供しない（[requirements.md](./requirements.md) の Non-goals）ので、日次運用タスクが古い version を消してよい。古い version が消えるので、Object Lock を有効にした bucket でも、削除と上書きの結果は 1 日以内に他の bucket と同じになる
- 一般ユーザーの policy は retention と legal hold を許さないので、削除できない version は作られない

## ネットワーク境界

外部に公開する endpoint は、S3 API と SPA の配信の 2 つだけである。filer（HTTP / gRPC）と master は、compose の内部 network の中だけで使う。

S3 API と SPA の配信は、別の subdomain に分ける。Host は SigV4 の署名対象なので、外向きの S3 endpoint と、presigned URL の生成時に使う endpoint は一致していなければならない。SPA と S3 API を同じ origin に置くと、この 2 つの endpoint を一致させるために path による振り分けが必要になり、署名の対象が環境ごとに変わる。

CORS には SeaweedFS だけが応答する。

- preflight の OPTIONS には、SeaweedFS が単独で応答する（認証は不要で、200 を返す）
- 許可する origin は、起動 flag（env の `KURA_S3_ALLOWED_ORIGINS`）で SeaweedFS に渡す。SeaweedFS は、この値から全 bucket に共通の fallback CORS config を作る
- `KURA_S3_ALLOWED_ORIGINS` は全環境で `*` にする。kura は cookie も ambient credential も使わず、認可は SigV4 署名（一時 credentials を持っていること）だけで決まるので、origin は認可の境界にならない。origin を列挙しても防げるものが無い一方で、ユーザーが権限を委譲した SP の origin が増えるたびに、設定の変更とコンテナの再作成が必要になる
- fallback CORS config は `AllowedHeaders: ["*"]` を持つ。SeaweedFS は `*` を、preflight の `Access-Control-Request-Headers` をそのまま返す、という意味で扱う。そのため、AWS SDK が付ける header（`amz-sdk-*`・`x-amz-*`・今後追加される checksum の header など）を gateway の設定に列挙する必要が無い

CORS に SeaweedFS だけが応答する形を保つために、次の 2 つを守る。

- 一般ユーザーの policy は、per-bucket の CORS を設定する操作を許さない（「認証と認可」）。per-bucket の CORS を設定すると、その bucket では fallback CORS config が使われなくなるためである
- gateway と SPA の配信 server は、`Access-Control-*` の header を付けない。gateway は preflight に自分で応答せず、SeaweedFS まで通す

その結果、全環境で CORS に応答するのは SeaweedFS だけになる。

## Keycloak client

kura は、realm に専用の public client を 1 つ持ち、Authorization Code + PKCE で認証する。

- redirect URI には、UI の origin の `/auth/callback` だけを完全一致で登録する。ワイルドカードにすると、攻撃者がログイン後の戻り先を同じホストの任意のパスに書き換えられるためである
- ブラウザを持たないホストから CLI で使えるように、device flow（RFC 8628）も有効にする。client の PKCE の強制は device authorization request にも適用されるので、device flow でも `code_challenge` が要る

access token には、kura が使う claim だけを載せる。presigned URL を受け取った相手に、発行した人の email や氏名が渡らないようにするためである（「presigned URL と一時 credentials の有効期間」）。

- client の default scope から、`profile`・`email`・`roles` を外す。`sub` は `basic` scope で access token に入る。admin の trust policy が `sub` を使う
- dedicated scope に 2 つの mapper を置く。audience mapper は、access token の `aud` に client id を入れる。SeaweedFS の OIDC provider は `aud` を検証に使う。user attribute mapper は、username を `preferred_username` claim に入れる。kura は `preferred_username` を bucket 名と policy 変数に使う
- kura は Keycloak の role を使わないので、dedicated scope の Full scope allowed は OFF にする
- admin 用の claim や mapper は作らない。admin の判定は、kura の trust policy が `sub` で行うためである

access token の lifespan は、client レベルで 5 分にする。SPA は、access token が切れる 1 分前に refresh token で access token を取り直す。Keycloak の SSO session は取り直すたびに延びるので、ユーザーがタブを開いている間は、realm の SSO session max まで認証が続く。

- lifespan を 1 分以下にすると、取り直しが絶え間なく続く
- lifespan を realm の SSO session idle より長くすると、取り直すときには SSO session が切れていて、取り直しが必ず失敗する
- presigned URL と一時 credentials の有効期間は STS session で決まるので、presigned URL や一時 credentials を長く使うために lifespan を延ばすことはしない

kura の client で取った offline token は、CLI の長いジョブで使う。offline token の期限は、client の Client Offline Session Max で 7 日に制限し、offline token で access token を取り直しても 7 日の期限が延びないようにする。7 日に制限するのは、kura の client が public client なので、XSS の攻撃者も `offline_access` を付けた認可 request で offline token を取れるためである。refresh token と offline token を出すために、client の Use refresh tokens は ON にする。

realm 全体の設定と既存の client は変更しない。realm は、DDBJ の全サービスが共有しているためである。

## SPA の配信

reference SPA の静的ビルドは、vite の preview server が配信する。配信のために別の技術で web server を用意せず、ビルドに使う道具をそのまま配信にも使う。

preview server は、設定ファイル（`vite.config.ts`）を読まずに起動する。起動は `scripts/serve-spa.ts` が `configFile: false` で行う。`vite.config.ts` は build plugin を import するが、runtime の image には devDependencies を入れないので、`vite.config.ts` を読み込むと起動に失敗するためである。

`appType` は `spa` で、preview server は未知のパスに index.html を返す。SPA の route に URL で直接アクセスできるのは、この fallback による。ただし、ビルド asset（`/assets/`）と、検索エンジンとプログラム向けの 3 つのファイル（robots.txt・sitemap.xml・llms.txt）は fallback の対象から外し、存在しなければ 404 を返す。理由は次の 2 つである。

- 再デプロイの前の index.html をキャッシュしたブラウザが古い asset 名を要求したときに、HTML が 200 で返ると、ブラウザは MIME エラーで SPA を読み込めない。MIME エラーは原因が分かりにくい
- 3 つのファイルについては、HTML が 200 で返ると、crawler が HTML を robots.txt や sitemap として読む

`allowedHosts` には、外向きの host 名を設定する。vite は localhost と IP アドレス以外の Host を既定で拒否するので、`allowedHosts` を設定しないと gateway を通った request が拒否される。

SPA の配信 server は、死活監視の専用 endpoint を持たない。SPA の配信 server の healthcheck は、`/`（index.html）を取得できるかで判定する。SPA の配信 server は CORS に応答しない。SPA の配信 server を通るのは SPA の asset だけで、ファイルの byte は 1 バイトも通らない。

SPA のビルドは、検索エンジンとプログラム向けに `/robots.txt`・`/sitemap.xml`・`/llms.txt` を `build/client` に書き出す。中身は環境ごとに違うので、SPA と同じく build 時の env で決まる（「reference SPA」）。

- 検索エンジンに載せるのは、トップページ（`/`）だけである。`/browse` 以下はログインした人の領域の一覧で、`/auth/` 以下はログインの途中のページなので、robots.txt でクロールを拒否する。sitemap.xml にはトップページだけを書く。robots.txt と sitemap.xml には絶対 URL が要るので、UI の origin（`KURA_UI_ORIGIN`）を build 時に埋め込む
- `KURA_NOINDEX` を `true` にした環境では、robots.txt で `/llms.txt` 以外のクロールを拒否し、sitemap.xml を作らず、index.html に noindex の meta を付ける。staging は production と同じ画面なので、staging が検索結果に production と並んで出ないようにするためである
- `/llms.txt` には、kura の説明と、プログラムから kura を使う方法を英語の Markdown で書く。使う方法として、S3 endpoint、OIDC の issuer と client id、device flow で取った access token を `AssumeRoleWithWebIdentity` に渡すこと、bucket 名が username であることを書く。詳しい手順として、[sp-integration.md](./sp-integration.md) の GitHub の URL を示す。プログラムで kura を使う読み手（LLM の agent など）に、画面ではなく S3 API を使ってもらうためである。`KURA_NOINDEX` を `true` にした環境でも、robots.txt は `/llms.txt` のクロールを許す

## web と ops の image

web と ops は、repo の `Dockerfile` の `runtime` stage から作る同じ image で動く。image に入れるのは次のものだけで、npm と npx は image から消す。web と ops のどちらの process も node で `.ts` を直接実行し、runtime では npm を使わないためである。

- SPA のビルド結果（`build/client`）
- `scripts/` と、`scripts/` が import する app のファイル
- `npm ci --omit=dev` で入れた依存 package

SPA のビルドは、同じ `Dockerfile` の `build` stage で行う。ビルドが読む env（「reference SPA」）は、compose が build arg として渡す。secret は build arg に入れない。

base image には、node の LTS の major の tag（`node:26-alpine`）を使い、patch version では固定しない。upstream が rebuild した base image は、`--pull` を付けて image を作り直したときに取り込まれる。runtime の image は非 root の `node` user で動き、host の directory を mount しない。

## reference SPA

SPA は kura の使い方の reference である。SPA は S3 API と STS を直接呼び、SPA と同じ操作は CLI（aws cli / curl）でもできる。SPA が無くても kura は成り立つ。SPA は React Router v8 の SPA モード（`ssr: false`）で作り、BFF は無い。SPA が要求する role は `KuraUserRole` だけで、SPA から admin 権限は取れない。

デプロイ固有の設定（OIDC の issuer と client id、S3 endpoint、ファイルの TTL、quota の既定値、UI の origin、検索エンジンに載せるか）は、build 時に bundle と静的ファイルに埋め込む。したがって image は、環境ごとにその環境の env でビルドする。kura は runtime の設定 JSON を持たない。OIDC の redirect URI は、UI の origin の設定ではなく、開いているページの origin（`window.location.origin`）から作る。

以下は、コードを読んでも意図を読み取りにくい判断である。

upload と resume: 新規の upload は、AWS SDK の lib-storage による multipart upload で行う。credentials provider が token の silent renew と STS の再取得を行うので、1 時間を超える upload でも credentials が切れない。エラーで upload が中断したときは、SPA はアップロード済みの part をサーバに残し、続きから再開できるようにする。part を破棄するのは、ユーザーが明示的にキャンセルしたときだけである。lib-storage は既存の upload の引き継ぎに対応しないので、再開の処理は自前で実装している。

1. 完了済みの part を `ListParts` で得る
2. ファイルサイズから part の分け方を決定論的に導き直し、残りの part を `UploadPart` で送る
3. `CompleteMultipartUpload` で upload を完成させる

同じセッションの中で失敗した upload は、File がメモリ上にあるので、進捗表示の「再開」から再開する。リロードしたあとは、一覧画面の「再開待ちのアップロード」でファイルを選び直して再開する。

resume の同一ファイル検証: SPA は、upload を完成させる前に、完了済みの part の ETag（SeaweedFS では part の内容の MD5）と、ローカルのファイルの同じ範囲の MD5 を照合する。照合は残りの part のアップロードと並行して行い、一致しなければ upload を中断して part を残す。サイズが同じで内容が変わったファイルで再開して、object が壊れるのを防ぐためである。放置された part は、日次運用タスクが multipart upload の掃除で破棄する。

zip download: 複数のファイルやディレクトリの download では、SPA が zip をブラウザの中で組み立てる。各 object の GetObject の応答をそのまま zip の stream に書き込むので、byte の経路上に kura 独自の server を置かない原則（「設計の原則」）は保たれる。zip は圧縮せずに格納だけする。対象の多くは既に圧縮されていて、CPU を使って再圧縮しても利点が無いためである。書き出し先は zip の大きさで分ける。

- 2 GB まで: Blob を作って、通常の download としてブラウザに渡す
- 2 GB を超える: File System Access API で、ユーザーが選んだファイルへ直接 stream で書き出す。メモリに載るのは処理中の chunk だけになる

大きさで分けるのは、File System Access API を使うと、ブラウザが「サイトにファイルの編集を許可するか」をユーザーに確認するためである。日常的な大きさの download でこの確認を出さないように、2 GB 以下では File System Access API を使わない。File System Access API を持たないブラウザでは、SPA は 2 GB を超える download を始める前に拒否し、CLI を案内する。

使用量メーター: SPA は ListObjectsV2 で全ページを走査し、object のサイズを合計して使用量を出す。フォルダ行のサイズと更新日時も、この 1 回の走査の結果を prefix ごとに集計して作る。S3 は CommonPrefixes にメタデータを返さないためである。メーターの分母は、ビルド時に埋め込んだ既定値である（「quota と TTL の実現」）。

presign の履歴: SPA は、session の中で発行した presigned URL の一覧を sessionStorage に保存する（bucket・key・url・method・expiresAt）。S3 側には presign の記録が残らないので、sessionStorage の他に一覧を得る手段が無い。ページを再読み込みすると、履歴は消える。key が変わる操作（rename / move）と削除のあとは、SPA はその key の記録を消す。presigned URL は key に対する署名なので、key が変わると古い key の URL は必ず 404 になるためである。

その他:

- design system は db-portal（BSI）のものを使い、色は BSI 紫（`#6F4392`）にする
- i18n は日本語と英語に対応する。言語は localStorage の値で決め、初回は `navigator.language` から推定する。URL に `?lang=ja|en` を付けると明示的に切り替えられる。SPA は `?lang=` の値を localStorage に保存し、URL から取り除く
- package manager は npm を使う

## SeaweedFS 由来の制約

SeaweedFS は release tag に pin して配備する。現在の pin は `4.51` である。pin を上げるときは、release notes を読み、下の表の各項目を新しい version で確かめる。

| 制約 | 影響する箇所 |
| --- | --- |
| IAM の policy engine は nested claim を扱えず、STS session を経由すると配列の claim が文字列に変換される | 設計の原則 / 認証と認可 |
| STS の signing key には決定論的な固定鍵が必須である（無いと起動に失敗する） | 認証と認可 |
| STS session の長さは `DurationSeconds` で決まり、上限は `sts.maxSessionLength` である。元の access token の有効期限では制限されない | presigned URL と一時 credentials の有効期間 |
| 一時 credentials の secret key は session token から導けない。session token を Bearer として受け付けない | presigned URL と一時 credentials の有効期間 |
| session token に access token の claim が書き込まれる | presigned URL と一時 credentials の有効期間 / Keycloak client |
| 同じ access token で `AssumeRoleWithWebIdentity` を何度でも呼べる（SPA はファイル操作用と presign 用に同じ token を使う） | reference SPA |
| policy の action 名は SeaweedFS が操作ごとに決め、multipart upload の各操作は独自の名前を持つ。版が上がると操作と action が増える | 認証と認可 |
| CreateBucket は Object Lock の有効化に権限を求めない。Object Lock を有効にした bucket は versioning が有効になり、削除しても古い version が残る | 認証と認可 / quota と TTL の実現 |
| per-bucket の quota は、超過すると bucket を read-only にし、write を HTTP 403 で拒否する | quota と TTL の実現 |
| bucket の quota の設定値は、S3 拡張（`?seaweedfs-quota`、action は `s3:GetBucketQuota` / `s3:PutBucketQuota`）で読み書きできる | 認証と認可 / quota と TTL の実現 |
| 初回の PUT による bucket の自動作成は admin 権限に限られ、STS で認証したユーザーには効かない | データの配置 |
| bucket の作成時に、S3 の bucket の命名規則を強制する | データの配置 |
| master は、volume 1 本のサイズ上限を 30720 MB（30 GiB）までに制限する | [operations.md](./operations.md) の「稼働の形」 |
| volume server は、データのファイルシステムの空きが `-volume.minFreeSpace`（既定は 1%）を下回ると、全 volume を read-only にする | [operations.md](./operations.md) の「稼働の形」 |
| `ListObjectsV2` と `ListMultipartUploads` は、`IsTruncated` と marker が食い違うことがある | reference SPA / [operations.md](./operations.md) の「日次運用タスク」 |
| 新しい collection（= bucket）に書き込むと、既定で volume を 7 本確保する | [operations.md](./operations.md) の「稼働の形」 |
| filer の API（HTTP / gRPC）には、S3 の IAM の認可が効かない | 認証と認可 / ネットワーク境界 |
