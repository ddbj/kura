# 設計

kura の実態は SeaweedFS（S3 + STS + IAM）の設定群である。独自の API server / BFF は作らない。作っても S3 API の wrapper にしかならず、ファイルの byte が通る経路を 1 つ増やすだけだからである。frontend は S3 API を直接叩く client の一例（reference 実装）で、その静的ビルドを配信する server が 1 つ付属する。

この文書は「なぜその形になっているか」を説明する。利用者への約束は [requirements.md](./requirements.md)、運用の判断は [operations.md](./operations.md) にある。

## 設計の原則

以下は kura のどの部分にも効く不変条件で、これを崩す変更は設計の変更として扱う。

- ファイルの byte を kura 独自のプロセスに通さない。upload / download は client と SeaweedFS S3 の直接転送で行う
- S3（SeaweedFS）が SSOT。状態はすべて S3 側にあり、別の DB を持たない
- SeaweedFS は upstream 公式のものだけを使う。fork も patch も作らず、upstream に無い機能や修正に依存しない構成に限る
- IAM policy / roleMapping が参照する JWT claim は top-level の scalar のみ。SeaweedFS の policy engine は nested claim を扱えず、配列 claim も STS session を経由すると文字列に潰れる
- 認証を持たない request を受け付ける経路を持たない。例外は SPA の静的 asset の配信だけで、そこにファイルの byte は流れない

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

SeaweedFS が S3 API・STS・IAM・filer を担い、ファイルの SSOT になる。SPA 配信 server は reference SPA の静的ビルドを配るだけの process で、kura の機能には一切関与しない。前段には TLS 終端と subdomain routing を行う gateway が居るが、これは kura repo の外の共用基盤である。認証は DDBJ account（Keycloak）で、kura 専用の client を 1 つ持つ。

## データの配置

ユーザーの領域は bucket そのものである。bucket 名は username（`preferred_username`）をそのまま使い、ファイル `<user>/<path>` の実体は bucket `<user>` 内の object `<path>`（filer path では `/buckets/<user>/<path>`）になる。

bucket は client（SPA / CLI）が初回 upload の前に作る。SeaweedFS の初回 PUT による bucket 自動作成は admin 権限でしか効かず、STS 認証の一般ユーザーには使えないためである。CreateBucket は既存 bucket に対して所有者であっても 409 を返す（`BucketAlreadyExists` / `BucketAlreadyOwnedByYou`）ので、存在確認は HeadBucket で行い、無いときだけ作成する。ユーザーから見れば初回 upload 時に領域が用意され、事前の申請は要らない。

username は sanitize せずそのまま bucket 名にする。SeaweedFS は bucket 作成時に S3 の命名規則（3-63 文字、小文字英数と `.` `-` のみ、先頭末尾は英数、`..` 連続・IP 形式・`xn--` 接頭辞・`-s3alias` 接尾辞・`filemeta` を拒否）を強制するので、DDBJ account の username 規則（3-24 文字、先頭は小文字英数、`a-z 0-9 _ -`）のうち `_` を含むものや `-` で終わるものは kura を利用できない。変換による救済はしない。単射な変換を認証経路上で表現できず、bucket 名と `preferred_username` claim が一致しなくなるためである。

ファイルツリーには本物のファイルだけが存在する。prefix による分類や marker object は持たない。例外は 1 つだけで、SPA の「新規フォルダ」操作は、以降 upload される file の親 prefix を可視化するために 0-byte の `.keep` object を作る。この object は SPA 上では非表示で、TTL の削除対象からも外す。

## 認証と認可

一般ユーザーの経路は 3 段階である。SPA（または CLI）が DDBJ Keycloak で OIDC 認証（Authorization Code + PKCE）を行い、token は client 側が保持する。client はその access token を SeaweedFS STS の `AssumeRoleWithWebIdentity` に渡して一時 credentials（access key / secret / session token）を得る。以後の S3 API はその一時 credentials の SigV4 署名で行う。

認可主体は 3 つあり、到達できる範囲が違う。

**`KuraUserRole`（一般ユーザー）** は roleMapping の `defaultRole` で、検証を通った access token は明示指定なしでこの role になる。policy は、kura が使う操作の action だけを、bucket `${jwt:preferred_username}` とその中の object に対して Allow する（bucket 名の位置での policy 変数展開は成立する）。bucket に対しては作成・一覧・multipart upload の一覧・location の取得、object に対しては読み書き・削除・multipart upload の各操作・tag の読み書きである（一覧は `seaweedfs/entrypoint.sh`）。bucket の設定を変える操作（policy・ACL・CORS・lifecycle・versioning・Object Lock・暗号化・quota など）は Allow に入れない。SeaweedFS は版を上げるたびに操作を増やすので、禁止する操作を並べる形では新しい操作が漏れる。許す操作を並べる形なら、増えた操作は既定で拒否される。これで、ユーザーが自分の bucket の公開範囲を広げる手段（bucket policy・ACL）と、自分の quota を変える手段が塞がれる。他人の bucket は read / write / list / 作成のすべてが拒否される。

**`KuraAdminRole`（admin の CLI 操作）** は全 bucket への `s3:*` を持つ。roleMapping では割り当てられず、`AssumeRoleWithWebIdentity` に `RoleArn` を明示した場合にだけ到達する。trust policy が `oidc:sub` を `KURA_ADMIN_SUBS` に列挙した Keycloak の `sub`（UUID）と照合し、一致しないものを拒否する。`KURA_ADMIN_SUBS` が空のときは実在しえない番兵値が入り、role 自体が assume 不能になる（fail-closed）。admin の判定が trust policy 側で完結するので、Keycloak 側に admin 用の claim も mapper も要らない。

**root identity（運用スクリプト）** は s3.json に定義した固定の access key / secret key で、Keycloak も STS も経由しない。日次運用タスクだけが使い、ユーザー経路からは到達できない。

trust policy は role の偽装、つまり token が対応しない role の指定を拒否する。

SeaweedFS 側の設定ファイルは 3 つある。iam.json は OIDC provider（issuer / clientId / jwksUri）、roleMapping、policy と role の定義、`sts.signingKey` を持ち、`sts.maxSessionLength` を 12h にしている。s3.json は root identity だけを持つ。anonymous identity は置かない。認証なしで S3 に触れる経路を作らないためである。security.toml は `jwt.filer_signing.key` と `jwt.filer_signing.read.key` に同じ鍵を入れ、filer の HTTP read / write と IAM gRPC service を Bearer token 必須にする。filer の API には S3 の IAM が効かないので、この鍵が無いと compose network 上のどのプロセス（SPA 配信 process も同じ network に居る）からでも全 bucket を無認証で読み書きできてしまう。read と write で鍵を分けないのは、どちらも cluster 内で完結して client に渡らず、2 本に増やしても脅威モデル上の利得が無いためである。

## presigned URL と一時 credentials の寿命

presigned URL（GET / PUT）は client が一時 credentials で自己生成する。サーバ側に発行 API は無く、署名計算は client 側で完結する。したがって一時 credentials を持つ者による presign の発行を、kura 側で禁止する手段は存在しない。

presigned URL の寿命は、署名に入れた `X-Amz-Expires` と、署名に使った一時 credentials（STS session）の残り時間の、短いほうになる。STS session の長さは `AssumeRoleWithWebIdentity` に渡した `DurationSeconds` で決まり、上限は `sts.maxSessionLength`（12 時間）で、指定しなければ `sts.tokenDuration`（1 時間）になる。元の access token の有効期限では頭打ちにならないので、5 分で切れる access token からも 12 時間の session を作れる。

SPA は presigned URL を発行するたびに新しい STS session を取り、`DurationSeconds` と `X-Amz-Expires` に同じ値を入れる。UI が提示する有効期限は「15分 / 1時間 / 12時間」で、どれもログインからの経過時間に関係しない。SPA がファイル操作に使う一時 credentials は `DurationSeconds` を指定せずに取り、切れる前に新しい access token で取り直す。SSO session が切れると access token を取り直せなくなるので、SPA の操作はそこで止まる。

STS session は発行後に revoke できない（AWS の仕様どおり）。credential の漏洩や presign の誤配布による暴露は自然失効まで続き、最大は 12 時間である。presigned URL を受け取った人がその URL の中の session token から secret key を導いて別の request に署名することはできない。SeaweedFS は secret key を STS の署名鍵で作るためである。

SeaweedFS は access token の claim を session token に書き込み、session token は presigned URL の `X-Amz-Security-Token` にそのまま載る。そのため kura の client の access token には、認証と認可に使う claim だけを載せる（「Keycloak client」）。

## 委譲（SP の非対話利用）

act-as-user 方式を採る。SP はユーザーの token で STS から一時 credentials を取り、ユーザー本人と同じ権限（自分の bucket のみ）で読み書きする。kura 側に SP 専用の実装も権限も無い。

ユーザーは自分の token を SP に渡すことで委譲する。長時間の処理では offline token を使う。SP は自分の Keycloak client でユーザーを認証するときに `offline_access` を要求し、得た offline token で access token を取り直し続けて STS を呼び直す。offline token の期限は SP の client の設定に従う。kura の client で取った offline token は 7 日で切れる（「Keycloak client」）。

## quota と TTL の実現

quota は SeaweedFS native の per-bucket quota（`s3.bucket.quota`）を使う。使用量は collection（= bucket）のメトリクスから取得され、kura は自前の容量カウンタを持たない。超過すると enforcement が bucket を read-only にし、write が HTTP 403（AccessDenied）で拒否される。使用量が quota を下回れば自動で解除される。新規 bucket への既定値の適用は、quota 未設定の bucket を見つけて既定値を設定する運用スクリプトで行う。

SPA が使用量メーターに出す上限は、ビルド時に焼き込んだ既定値である。bucket の quota の設定値を読む操作は SeaweedFS の S3 拡張にしか無く、一般ユーザーの policy では許していないためである。admin がユーザー単位に変更した quota は UI に反映されない。

全ファイル TTL は、作成時刻に TTL を足した時刻を過ぎた object を削除する日次の運用スクリプトで実現する。SeaweedFS の volume TTL は使わない。失効後も一覧に残り、読み出しだけがエラーになる断片状態が生じるためである。S3 lifecycle も使わない。bucket ごとのルール適用と worker の運用が必要になる割に、単純な日次削除と結果が変わらないためである。

ユーザーが CLI で Object Lock を有効にして bucket を作ると、その bucket は versioning が有効になり、削除や上書きをしても古い version が残る。CreateBucket が Object Lock の有効化に権限を求めないためである（「SeaweedFS 由来の制約」）。古い version は quota の使用量に数えられるが、一般ユーザーの policy は version を一覧・削除する操作を許さないので、ユーザーは古い version を消せない。そこで日次の運用スクリプトが、versioning が有効な bucket の古い version と delete marker を、TTL の設定に関係なくすべて削除する。一般ユーザーは versioning を変える操作も許されないので、versioning が有効な bucket は Object Lock を有効にして作った bucket だけである。kura は versioning を提供しないので（[requirements.md](./requirements.md) の Non-goals）、削除と上書きの結果は 1 日以内に他の bucket と同じになる。retention と legal hold は一般ユーザーの policy が許さないので、消せない version は作られない。

## ネットワーク境界

外部に出る endpoint は S3 API と SPA 配信の 2 つだけで、filer（HTTP / gRPC）と master は compose の内部 network に閉じる。

この 2 つは別の subdomain に分ける。Host は SigV4 の署名対象なので、外向きの S3 endpoint と presign 生成時に使う endpoint は一致していなければならない。SPA と S3 API を同一 origin に同居させると、この一致を保つために path ベースの分岐が要り、署名の対象が環境ごとに変わる。

CORS には SeaweedFS だけが応答する。preflight OPTIONS は SeaweedFS が単独で完結させる（auth 不要、200）。許可 origin は起動 flag（env `KURA_S3_ALLOWED_ORIGINS`）で渡し、そこから全 bucket 共通の fallback CORS config が生成される。この値は全環境で `*` にする。kura は cookie も ambient credential も使わず、認可は SigV4 署名（= 一時 credentials を持っていること）だけで決まるので、origin は認可の境界にならない。列挙しても防げるものが無い一方、ユーザーが権限を委譲した SP の origin が増えるたびに設定変更とコンテナ再作成が要る。この config は `AllowedHeaders: ["*"]` を持ち、SeaweedFS はこれを「preflight の `Access-Control-Request-Headers` を verbatim で echo する」意味で扱う。おかげで AWS SDK が付ける header 群（`amz-sdk-*` / `x-amz-*` / 将来追加される checksum バリアント等）を gateway 側で列挙する必要が無い。

この形を保つために、一般ユーザーの policy は per-bucket の CORS を設定する操作を許さず（「認証と認可」）、per-bucket CORS による fallback の無効化を防ぐ。gateway と SPA 配信 server は `Access-Control-*` を付けず、preflight も短絡させない。結果として全環境で CORS の応答経路が単一化される。

## Keycloak client

kura は realm 上に専用の public client を 1 つ持ち、Authorization Code + PKCE で認証する。redirect URI は UI origin の `/auth/callback` だけを完全一致で登録する。ワイルドカードにすると、ログイン後の戻り先を同じホストの任意のパスに書き換えられるためである。ブラウザを持たないホストから CLI で使うために device flow（RFC 8628）も有効にする。client の PKCE 強制は device authorization request にも適用されるので、この経路でも `code_challenge` が要る。

access token には kura が使う claim だけを載せる。presigned URL を渡した相手に、発行した人の email や氏名が渡らないようにするためである（「presigned URL と一時 credentials の寿命」）。client の default scope からは `profile`・`email`・`roles` を外し、`sub` は `basic` scope が入れる（admin の trust policy が使う）。dedicated scope には 2 つの mapper を置く。audience mapper は access token の `aud` に client id を入れ、SeaweedFS の OIDC provider が検証に使う。user attribute mapper は username を `preferred_username` claim に入れ、bucket 名と policy 変数に使う。kura は Keycloak の role を使わないので、dedicated scope の Full scope allowed は OFF にする。admin 用の claim や mapper も作らない。admin の判定は kura 側の trust policy が `sub` で行うためである。

access token の lifespan は client レベルで 5 分にする。SPA は access token が切れる 1 分前に refresh token で取り直し、Keycloak の SSO session はそのたびに延びるので、タブを開いている間は realm の SSO session max まで認証が続く。lifespan を 1 分以下にすると取り直しが休みなく続き、realm の SSO session idle より長くすると、取り直すときには session が切れていて必ず失敗する。presigned URL と一時 credentials の寿命は STS session で決まるので、そのために lifespan を延ばさない。

kura の client で取った offline token（CLI の長いジョブで使う）は、client の Client Offline Session Max で 7 日に切り、取り直しても延びないようにする。public client なので、XSS の攻撃者も `offline_access` を付けた認可 request で offline token を取れるためである。refresh token と offline token を出すために、client の Use refresh tokens は ON にしておく。

realm 全体の設定と既存 client には手を入れない。realm は全 DDBJ サービスの共有資産だからである。

## SPA の配信

reference SPA の静的ビルドは vite の preview server が配信する。専用の web server を別技術で用意せず、ビルドに使う道具をそのまま配信にも使う。

起動は設定ファイルを介さず、`configFile: false` で preview server を直接起動する運用スクリプトで行う。設定ファイル（`vite.config.ts`）は build plugin を import するが、runtime の image には devDependencies を入れないので、読み込めないためである。

`appType` は `spa` で、未知のパスは index.html に fallback する。SPA route の直接アクセスはこれで成立する。ただしビルド asset（`/assets/`）と、検索エンジンとプログラム向けの 3 つのファイル（下記）は fallback の対象外にし、存在しなければ 404 を返す。再デプロイ前の index.html をキャッシュしたブラウザが古い asset 名を要求したとき、HTML が 200 で返ると MIME エラーという分かりにくい壊れ方をするためである。3 つのファイルも、HTML が 200 で返ると crawler が HTML を robots.txt や sitemap として読む。

`allowedHosts` には外向きの host 名を設定する。vite は localhost と IP 直打ち以外の Host を既定で拒否するので、設定しないと gateway 経由の request が通らない。

死活監視のための専用 endpoint は持たず、healthcheck は `/`（index.html）の取得で判定する。CORS には応答しない。この process を通るのは SPA の asset だけで、ファイルの byte は 1 バイトも通らない。

検索エンジンとプログラム向けに、`/robots.txt`・`/sitemap.xml`・`/llms.txt` を SPA のビルドで `build/client` に書き出す。中身は環境ごとに違うので、SPA と同じく build 時の env で決まる（「reference SPA」）。

- 検索エンジンに載せるのはトップページ（`/`）だけである。`/browse` 以下はログインした人の領域の一覧で、`/auth/` 以下はログインの途中のページなので、robots.txt でクロールを拒否する。sitemap.xml にはトップページだけを書く。robots.txt と sitemap.xml には絶対 URL が要るので、UI origin（`KURA_UI_ORIGIN`）を build 時に焼き込む
- `KURA_NOINDEX` を `true` にした環境では、robots.txt で `/llms.txt` 以外のクロールを拒否し、sitemap.xml を作らず、index.html に noindex の meta を付ける。staging は production と同じ画面なので、検索結果に production と並んで出ないようにするためである
- `/llms.txt` には、kura の説明と、プログラムから使う方法（S3 endpoint、OIDC issuer と client id、device flow で取った access token を `AssumeRoleWithWebIdentity` に渡すこと、bucket 名が username であること）を英語の Markdown で書き、詳しい手順として [sp-integration.md](./sp-integration.md) の GitHub の URL を示す。プログラムで使う読み手（LLM の agent など）に、画面ではなく S3 API を使ってもらうためである。`KURA_NOINDEX` の環境でも robots.txt で読めるようにする

## web と ops の image

web と ops は、repo の `Dockerfile` の `runtime` stage から作る同じ image で動く。image に入れるのは、SPA のビルド結果（`build/client`）、`scripts/` と `scripts/` が import する app のファイル、`npm ci --omit=dev` で入れた依存 package だけで、npm と npx は消す。どちらの process も node で `.ts` を直接実行し、runtime で npm を使わないためである。SPA のビルドは同じ `Dockerfile` の `build` stage で行い、ビルドが読む env（「reference SPA」）は compose が build arg として渡す。secret は build arg に入れない。

base image は node の LTS の major の tag（`node:26-alpine`）を使い、patch version では固定しない。upstream が rebuild した base image は、`--pull` を付けて image を作り直したときに取り込まれる。runtime の image は非 root の `node` user で動き、host の directory を mount しない。

## reference SPA

SPA は kura の使い方の reference である。S3 API と STS を直接叩き、同じ操作は CLI（aws cli / curl）でもできる。SPA が無くても kura は成立する。React Router v8 の SPA モード（`ssr: false`）で、BFF は無い。要求する role は `KuraUserRole` だけで、SPA から admin 権限は取れない。

デプロイ固有の設定（OIDC issuer / client id / S3 endpoint / ファイル TTL / quota の既定値 / UI origin / 検索エンジンに載せるか）は build 時に bundle と静的ファイルへ焼き込む。したがって image は環境ごとにその環境の env でビルドする。runtime の設定 JSON は持たない。OIDC の redirect URI は、UI origin の設定ではなく、開いているページの origin（`window.location.origin`）から導出する。

以下は、コードを読んでも意図が復元しにくい判断である。

**upload と resume** — 新規の upload は AWS SDK の lib-storage による multipart upload で行い、credentials provider が token の silent renew と STS 再取得を行って 1 時間を超える upload でも credentials を切らさない。エラーで中断した upload はアップロード済みの part をサーバに残し、続きから再開できる。明示的なキャンセルだけが part を破棄する。再開の経路は自前実装である（lib-storage は既存 upload の引き継ぎに対応しない）。完了済み part を `ListParts` で得て、ファイルサイズから決定論的に再導出した part 割りに対して残りを `UploadPart` し、`CompleteMultipartUpload` で仕上げる。同一セッション内の失敗は進捗表示の「再開」から（File がメモリ上にある）、リロード後は一覧画面の「再開待ちのアップロード」からファイルを選び直して再開する。

**resume の同一ファイル検証** — 完了済み part の ETag（SeaweedFS では part 内容の MD5）とローカルファイルの該当 range の MD5 を照合してから完成させる。照合は残り part のアップロードと並行に走り、不一致なら中断して part を残す。サイズが同じでも内容が変わったファイルによる object 破損を防ぐためである。放置された part は運用の日次掃除が回収する。

**zip download** — 複数ファイルやディレクトリの download は zip をブラウザ内で組み立てる。各 object の GetObject 応答をそのまま zip stream へ流すので、byte がバックエンドを経由しない原則は保たれる。圧縮はせず格納のみ。対象の多くが既に圧縮済みで、再圧縮に CPU を使う利得が無いためである。書き出し先は大きさで分ける。2 GB までは Blob を作って通常の download として渡し、それを超えるものは File System Access API でユーザーが選んだファイルへ直接ストリームする（メモリに載るのは処理中の chunk だけになる）。分岐の理由は、同 API を使うとブラウザが「サイトにファイルの編集を許可するか」を確認するためで、日常的な大きさの取得でその確認を出さないようにしている。API を持たないブラウザでは 2 GB 超の取得を発行前に拒否し、CLI へ誘導する。

**使用量メーター** — 使用量は ListObjectsV2 を全ページ走査して積算する。フォルダ行のサイズと更新日時もこの 1 回の走査を prefix ごとに畳んで作る（S3 は CommonPrefixes にメタデータを返さないため）。分母はビルド時に焼き込んだ既定値である（「quota と TTL の実現」参照）。

**presign の履歴** — session 中に発行した presigned URL の一覧は sessionStorage に持つ（bucket / key / url / method / expiresAt）。S3 側に presign の痕跡は残らないので、これ以外に列挙する手段が無い。ページを再読み込みすれば履歴は消える。key が変わる操作（rename / move）と削除のあとは記録を落とす。presign は key に対する署名なので、key が変われば必ず 404 になるからである。

このほか、design system は db-portal（BSI）のものを使い、色は BSI 紫（`#6F4392`）。i18n は ja / en で、言語解決は localStorage を基準に、初回は `navigator.language` から推定し、`?lang=ja|en` の URL hint で明示切替できる（hint は localStorage へ永続化して URL から除去する）。package manager は npm。

## SeaweedFS 由来の制約

SeaweedFS は release tag に pin して配備する。現在の pin は `4.51` である。pin を上げるときは release notes を読み、下表の各項目を新しい version に対して確かめる。

| 制約 | 影響する箇所 |
| --- | --- |
| IAM policy engine は nested claim を扱えず、STS session 経由では配列 claim が文字列に潰れる | 設計の原則 / 認証と認可 |
| STS signing key は決定論的な固定鍵が必須（無いと起動失敗） | 認証と認可 |
| STS session の長さは `DurationSeconds` で決まり、上限は `sts.maxSessionLength`。元の access token の有効期限では頭打ちにならない | presigned URL と一時 credentials の寿命 |
| 一時 credentials の secret key は session token から導けず、session token を Bearer として受け付けない | presigned URL と一時 credentials の寿命 |
| session token に access token の claim が書き込まれる | presigned URL と一時 credentials の寿命 / Keycloak client |
| 同じ access token で `AssumeRoleWithWebIdentity` を何度でも呼べる（SPA はファイル操作用と presign 用に同じ token を使う） | reference SPA |
| policy の action 名は操作ごとに SeaweedFS が決め、multipart upload の各操作は独自の名前を持つ。版を上げると操作と action が増える | 認証と認可 |
| CreateBucket は Object Lock の有効化に権限を求めない。有効にした bucket は versioning が有効になり、削除しても古い version が残る | 認証と認可 / quota と TTL の実現 |
| per-bucket quota は超過で bucket を read-only にし、write を HTTP 403 で拒否する | quota と TTL の実現 |
| bucket の quota 設定値は S3 拡張（`?seaweedfs-quota`、action は `s3:GetBucketQuota` / `s3:PutBucketQuota`）で読み書きできる | 認証と認可 / quota と TTL の実現 |
| 初回 PUT による bucket の auto-create は admin 権限限定で、STS 認証のユーザーには効かない | データの配置 |
| bucket 作成時に S3 の bucket 命名規則を強制する | データの配置 |
| master は volume 1 本のサイズ上限に 30720 MB (30 GiB) の天井を持つ | 運用（稼働の形） |
| volume server は、データのファイルシステムの空きが `-volume.minFreeSpace`（既定は 1%）を下回ると全 volume を read-only にする | 運用（稼働の形） |
| `ListObjectsV2` と `ListMultipartUploads` は `IsTruncated` と marker が食い違うことがある | reference SPA / 運用（日次運用タスク） |
| 新規 collection（= bucket）への書き込みは default で volume を 7 本確保する | 運用（稼働の形） |
| filer API（HTTP / gRPC）には S3 IAM の認可が効かない | 認証と認可 / ネットワーク境界 |
