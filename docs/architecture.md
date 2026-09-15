# kura 技術仕様

kura の実態は SeaweedFS（S3 + STS + IAM）の設定群である。独自の API server / BFF は作らない（S3 API の wrapper にしかならないため）。frontend は S3 API を直接叩く client の一例としての reference 実装で、その静的ビルドを配信する server が 1 つ付属する。

要求仕様は [requirements.md](./requirements.md)、運用仕様は [operations.md](./operations.md)、テスト・検証仕様は [testing.md](./testing.md) を参照。

## 原則

- ファイルの byte を kura 独自のプロセスに通さない。upload / download は client <-> SeaweedFS S3 の直接転送で行う
- S3（SeaweedFS）が SSOT。すべての状態は S3 側にあり、別の DB を持たない
- SeaweedFS は upstream 公式のみを使う（fork / patch 禁止）。upstream master HEAD で成立する構成に限る（upstream に無い機能・修正に依存しない）
- IAM policy / roleMapping で参照する JWT claim は top-level の scalar のみ（SeaweedFS の policy engine が nested / 配列 claim を扱えないため）
- 認証を持たない request を受け付ける経路を持たない。SPA の静的 asset の配信だけが例外で、そこにファイルの byte は流れない

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

コンポーネント:

- SeaweedFS: S3 API・STS・IAM・filer。ファイルの SSOT
- SPA 配信 server: reference SPA の静的ビルドを配信するだけの process。kura の機能には一切関与しない（「SPA の配信」参照）
- DDBJ gateway（`ddbj/service-gateway-conf` の gw-nginx。kura repo の外）: TLS 終端・subdomain routing
- DDBJ Keycloak: 認証（OIDC）。kura 専用の client を持つ
- reference SPA: React SPA。STS と S3 API を直接叩く

## 配置（per-user bucket）

- ユーザーの領域は bucket そのもの。bucket 名 = username（`preferred_username`）
- ファイル `<user>/<path>` の実体は bucket `<user>` 内の object `<path>`（filer path は `/buckets/<user>/<path>`）
- bucket は client（SPA / CLI）が初回 upload の前に作成する。CreateBucket は既存 bucket に対して所有者でも 409 を返す（`BucketAlreadyExists` / `BucketAlreadyOwnedByYou`）ため、存在確認は HeadBucket で行い、無いときだけ CreateBucket する。ユーザーから見れば初回 upload 時に領域が自動で用意され、事前の申請は無い
- prefix による分類や marker object は無く、ファイルツリーには本物のファイルだけが存在する。例外は 1 つだけで、SPA の「新規フォルダ」操作は、以降 upload される file の親 prefix を可視化するために 0-byte の `.keep` object を作る（`.keep` は SPA 上非表示、TTL の削除対象外）。この 1 例以外に marker object は使わない
- bucket 名 = username は sanitize せずそのまま使う。SeaweedFS は bucket 作成時に S3 の命名規則（3-63 文字、小文字英数と `.` `-` のみ、先頭末尾は英数、`..` 連続・IP 形式・`xn--` 接頭辞・`-s3alias` 接尾辞・`filemeta` を拒否）を強制する。DDBJ account の username 規則（3-24 文字、先頭は小文字英数、`a-z 0-9 _ -`）のうち、`_` を含む・`-` で終わる等の username はこの規則に適合せず、kura を利用できない（単射な変換を認証経路上で表現できないため、変換による救済はしない）

## 認証・認可

一般ユーザーのフロー:

1. SPA（または CLI）が DDBJ Keycloak で OIDC 認証（Authorization Code + PKCE）。token は client 側が保持する
2. client が access token を SeaweedFS STS `AssumeRoleWithWebIdentity` に渡し、一時 credentials（access key / secret / session token）を得る
3. 以後の S3 API は一時 credentials の SigV4 署名で行う

kura が持つ認可主体は 3 つで、それぞれ到達できる範囲が違う。

**`KuraUserRole`（一般ユーザー）** — roleMapping の `defaultRole`。検証を通った access token は明示指定なしでこの role になる。policy は bucket `${jwt:preferred_username}` への `s3:*` を Allow し（bucket 名位置での policy 変数展開は成立する）、全 bucket に対して bucket 管理系の操作を明示 Deny する（`s3:PutBucketPolicy` / `DeleteBucketPolicy` / `PutBucketAcl` / `PutObjectAcl` / `PutBucketCors` / `DeleteBucketCors` / `PutLifecycleConfiguration` / `DeleteLifecycleConfiguration` / `PutBucketVersioning` / `PutObjectLockConfiguration` / `PutObjectRetention` / `PutObjectLegalHold`）。`s3:*` の Allow が必要なのは、bucket 作成（CreateBucket）の認可が SeaweedFS 内部で細粒度 action に解決されないため。明示 Deny は Allow より常に優先するので、ユーザーが自分の bucket の公開範囲を広げる手段（bucket policy / ACL）は塞がれている。他人の bucket は read / write / list / 作成すべて拒否される。

**`KuraAdminRole`（admin の CLI 操作）** — 全 bucket への `s3:*`。roleMapping では割り当てられず、`AssumeRoleWithWebIdentity` に `RoleArn` を明示した場合にだけ到達する。trust policy が `oidc:sub` を `KURA_ADMIN_SUBS` に列挙した Keycloak の `sub`（UUID）と照合し、一致しないものを拒否する。`KURA_ADMIN_SUBS` が空のときは、実在しえない番兵値が入って role 自体が assume 不能になる（fail-closed）。admin 判定は trust policy 側で完結するので、Keycloak に admin 用の claim / mapper は要らない。この role を使うのは CLI（aws cli 等）からの管理操作で、SPA はこの role を要求しない（[requirements.md](./requirements.md) の「認証と利用者」）。

**root identity（運用スクリプト）** — s3.json に定義した固定の access key / secret key。Keycloak も STS も経由しない。日次運用タスク（quota reconciler / TTL sweep / multipart 掃除）だけが使い、ユーザー経路からは到達できない（[operations.md](./operations.md)）。

trust policy は role の偽装（token が対応しない role の指定）を拒否する。

SeaweedFS の設定ファイル:

- iam.json: OIDC provider（issuer = DDBJ Keycloak realm、clientId、jwksUri）、roleMapping、policy と role の定義、`sts.signingKey`（固定値を secret 注入）。`sts.maxSessionLength` は 12h
- s3.json: root identity のみ。anonymous identity は置かない（認証なしで S3 に触れる経路を作らないため）
- security.toml: `jwt.filer_signing.key` と `jwt.filer_signing.read.key`（同一の固定値を secret 注入）。filer の HTTP read / write と IAM gRPC service を Bearer token 必須にする。filer の API には S3 の IAM が効かないため、これが無いと compose network 上のどのプロセスからでも全 bucket を無認証で読み書きできてしまう（SPA 配信プロセスも同じ network にいる）。read と write で鍵を分けないのは、どちらも cluster 内で完結し client に渡らないため、鍵を 2 本に増やしても脅威モデル上の利得が無く運用対象が増えるだけだから。cluster 内のコンポーネント（S3 server を含む）は同じ設定ファイルの鍵で自動署名する

secret の生成と注入は [operations.md](./operations.md) の「secret 管理」を参照。

## presign

- SPA / CLI が一時 credentials で SigV4 presigned URL（GET / PUT）を自己生成する。サーバ側に発行 API は無く、署名計算は client 側で完結する。したがって一時 credentials を持つ者による presign の発行を kura 側で禁止する手段は無い
- 寿命は STS session の残り時間に cap される（session が切れた presign は `X-Amz-Expires` が残っていても 403）。session 長は min(元 access token の exp 残り, 要求した `DurationSeconds`, `sts.maxSessionLength`) で決まる。`DurationSeconds` の上限 43200s (12h) は SeaweedFS 内の固定値のため設定では超えられない
- 実際に効く天井は多くの場合「access token の exp 残り」である。Keycloak は access token の exp を SSO session の終了時刻で頭打ちにするため、client の lifespan を 12h にしても realm の SSO session max（10h）を超える token は発行されない。exp の起点はログイン時刻なので、発行できる presign の寿命はログインからの経過とともに縮む（ログイン直後で約 10 時間、9 時間経過後なら約 1 時間）。発行時に token を取り直しても同じ天井に当たる
- したがって UI が提示する有効期限は「15分 / 1時間 / 最長」であり、「最長」は上限を要求したうえで session 残りに切り詰められた実効値を表示する
- STS session は SeaweedFS 側で発行後 revoke できない（AWS 仕様どおり）。credential 漏洩・presign 誤配布時の暴露は自然失効まで続く（仕様上の最大は 12 時間、実際には上記の天井まで）

## SP による非対話利用（identity 委譲）

- act-as-user 方式: SP はユーザーの token で STS から一時 credentials を取り、ユーザー本人と同じ権限（自 bucket のみ）で読み書きする。kura 側に SP 専用の実装・権限は無い
- ユーザーが自分の token を SP に渡すことで委譲する。長時間の処理では offline token を使う: ユーザーは scope に `offline_access` を付けて認証し、得られた refresh token（Offline 型、期限なし・idle 30 日で失効）を SP に渡す。SP は refresh で access token を得続け、STS を再取得する。client 側の追加設定は不要（`offline_access` は optional scope として利用可能）

## quota と TTL の実現

- quota は SeaweedFS native の per-bucket quota（`s3.bucket.quota`）を使う。使用量は collection（= bucket）のメトリクスから取得され、自前の容量カウンタは持たない。超過すると enforcement（約 1 分周期）が bucket を read-only にし、write がエラー（HTTP 500。filer の 507 が S3 層で generic エラーになる）で拒否される。使用量が quota を下回れば自動で解除される（削除の反映は volume の vacuum 後）
- 新規 bucket への quota default は、quota 未設定の bucket に default を設定する運用スクリプト（reconciler）を定期実行して適用する（[operations.md](./operations.md)）
- **S3 API には bucket の quota 設定値を読む手段が無い**。SPA が使用量メーターに出す上限はビルド時に焼き込んだ deployment の default 値であり、admin がユーザー単位に変更した quota は UI に反映されない（「frontend」参照）
- 全ファイル TTL は、作成時刻 + TTL を過ぎた object を削除する日次の運用スクリプトで実現する。SeaweedFS の volume TTL は使わない（失効後も一覧に残り、読み出しがエラーになる断片状態が生じるため）。S3 lifecycle も使わない（bucket ごとのルール適用と worker の運用が必要になる割に、単純な日次削除と結果が変わらないため）

## ドメインと routing

subdomain 分離:

- `kura.ddbj.nig.ac.jp`: SPA（静的配信のみ）
- `kura-s3.ddbj.nig.ac.jp`: S3 API（SeaweedFS S3）。Host は SigV4 の署名対象なので、外向き endpoint と presign 生成時の endpoint を一致させる

前段の gateway:

- DDBJ gateway（gw-nginx）が TLS 終端・subdomain routing を担当する。gateway が `/ga4gh/` を予約 prefix として分岐する（別サービス用。kura は使わない）
- filer（HTTP / gRPC）と master は compose の内部 network に閉じ、外部から到達できる kura の endpoint は S3 API と SPA 配信の 2 つだけである

CORS:

- CORS は SeaweedFS の per-bucket CORS middleware が応答する。preflight OPTIONS は SeaweedFS が単独で完結する（auth 不要、200 OK）
- 許可 origin は起動 flag `-s3.allowedOrigins` に渡す（env `KURA_S3_ALLOWED_ORIGINS`）。全 bucket 共通の fallback CORS config がここから生成され、`AllowedHeaders: ["*"]` を持つ。SeaweedFS はこの `*` を「preflight の `Access-Control-Request-Headers` を verbatim echo する」意味で扱うため、AWS SDK が付ける header 群（`amz-sdk-*` / `x-amz-*` / 将来追加される checksum バリアント等）を gateway 側で列挙する必要が無い
- 一般ユーザーが per-bucket CORS を PutBucketCors で上書きして fallback を無効化しないよう、IAM policy で `s3:PutBucketCors` / `s3:DeleteBucketCors` を Deny する（「認証・認可」参照）
- gateway と SPA 配信 server は CORS header を touch しない（`Access-Control-*` を付けない、preflight OPTIONS も短絡させず素通しする）。dev / staging / production で CORS 応答経路が単一化される

## Keycloak client

- client: `kura-dev`（staging realm）/ `kura`（production realm）。public client、Authorization Code + PKCE
- issuer: staging = `https://idp-staging.ddbj.nig.ac.jp/realms/master`、production = `https://idp.ddbj.nig.ac.jp/realms/master`
- client dedicated scope の protocol mapper: audience mapper（access token の `aud` に client id を入れる。SeaweedFS OIDC provider の検証用）。admin 用の claim / mapper は作らない（admin は kura 側の trust policy が `sub` で判定する。「認証・認可」参照）
- access token lifespan: client レベルの override で 43200s (12h) に設定する（realm default は 60s）。ただし実際に発行される token の exp は realm の SSO session max（10h、ログイン時刻起点）で頭打ちになるため、この override が効くのはその範囲内だけである。SSO session max と idle timeout（30 分）は client override では伸ばせない Keycloak 仕様なので、SPA 上での連続作業も presign の寿命もこの realm 側の値が上限になる。長時間の作業は SPA の credentials provider が silent renew と STS 再取得で継続する（発行済みの presign は STS session として独立して動くので、発行後に SSO session が切れても失効しない）
- realm 全体の設定・既存 client には手を入れない（master realm は全 DDBJ サービスの共有資産）

## SPA の配信

reference SPA の静的ビルド（`build/client`）は vite の preview server が配信する。専用の web server を別技術で用意せず、ビルドに使う道具をそのまま配信にも使う。

- 起動は設定ファイルを介さず、`configFile: false` で preview server を直接起動する運用スクリプトで行う。build plugin を読み込まないので、配備先の runtime に必要な npm package は vite だけになる。設定ファイルを使うと vite がそれを bundle して `node_modules/.vite-temp` に書き出すため、read-only の bind mount と両立しない
- `appType` は `spa`。未知のパスは index.html に fallback し、`/browse/*` や `/auth/callback` の直接アクセスが成立する
- ただしビルド asset（`/assets/`）は fallback の対象外にし、存在しなければ 404 を返す。再デプロイ前の index.html をキャッシュしたブラウザが古い asset 名を要求したとき、HTML が 200 で返ると MIME エラーという分かりにくい壊れ方をするため
- `allowedHosts` に外向きの host 名を設定する。vite は localhost と IP 直打ち以外の Host を既定で拒否するので、設定しないと gateway 経由の request が通らない
- CORS には応答しない（応答するのは SeaweedFS だけ、という上記の不変条件を守るため）
- 死活監視のための専用 endpoint は持たない。healthcheck は `/`（index.html）を取得して判定する
- この process を通るのは SPA の asset だけで、ファイルの byte は 1 バイトも通らない

## frontend（reference SPA）

- 位置づけ: kura の使い方の reference。S3 API + STS を直接叩き、同じ操作は CLI（aws cli / curl）でも可能。frontend が無くても kura は成立する
- React Router v7 の SPA モード（`ssr: false`、SSR なし）。BFF は無い
- デプロイ固有の設定（OIDC issuer / client id / S3 endpoint / ファイル TTL / quota default）は `VITE_` 接頭辞の環境変数として build 時に bundle へ焼き込む。したがって環境ごとに build する。OIDC の redirect URI は `window.location.origin` から導出するため設定に含めない
- auth: react-oidc-context（PKCE、automaticSilentRenew。public client への refresh token grant で更新する）。要求する role は `KuraUserRole` だけで、SPA から admin 権限は取れない
- 初回利用: HeadBucket で自分の bucket の存在を確認し、無ければ CreateBucket する（「配置」参照）
- upload: AWS SDK lib-storage の multipart upload。credentials provider が token の silent renew -> STS 再取得を行い、1 時間を超える upload でも credentials を切らさない
- upload の中断と再開（resume）: エラーで中断した upload はアップロード済みの part をサーバに残し（`leavePartsOnError`）、続きから再開できる。明示的なキャンセルだけが part を破棄する（`AbortMultipartUpload`）。再開経路は自前実装（lib-storage は resume 非対応）: `ListParts` で完了済み part を得て、ファイルサイズから決定論的に再導出した part 割りに対して残りの part を `UploadPart` し、`CompleteMultipartUpload` で仕上げる。同一セッション内の失敗は進捗 Toast の「再開」から（File はメモリ上にある）、リロード後は一覧画面の「再開待ちのアップロード」（`ListMultipartUploads`。SeaweedFS は開始時刻を返さないため、直近の活動は part の LastModified から導出する）でファイルを選び直して再開する
- resume の同一ファイル検証: 完了済み part の ETag（SeaweedFS では part 内容の MD5）とローカルファイルの該当 range の MD5 を照合してから完成させる。照合は残り part のアップロードと並行に走り、不一致なら中断して part を残す（サイズが同じでも内容が変わったファイルによるオブジェクト破損を防ぐ）。放置された part は運用の日次掃除が回収する（[operations.md](./operations.md)）
- 複数ファイル / ディレクトリの download は zip をブラウザ内で組み立てる（サーバ側に zip を作る経路は無い）。各オブジェクトの GetObject 応答をそのまま zip stream へ流すので、byte がバックエンドを経由しない原則は保たれる。圧縮はせず格納のみ（対象の多くが既に圧縮済みで、再圧縮に CPU を使う利得が無い）
- zip の書き出し先は大きさで決める。2 GB までは Blob を作って通常の download として渡す。File System Access API を使うとブラウザが「サイトにファイルの編集を許可するか」を確認するため、日常的な大きさの取得でその確認を出さないための切り分けである。2 GB を超えるものは同 API でユーザーが選んだファイルへ直接ストリームし（メモリに載るのは処理中のチャンクだけ）、API を持たないブラウザでは発行前に拒否して S3 client（CLI）へ誘導する
- 使用量メーターの使用量は ListObjectsV2 を全ページ走査して積算する。フォルダ行のサイズ・更新日時もこの 1 回の走査を prefix ごとに畳んで作る（S3 は CommonPrefixes にメタデータを返さないため）。分母はビルド時に焼き込んだ deployment の quota default で、ユーザー単位の override は反映されない（「quota と TTL の実現」参照）
- 「期限つき」レンズ（session 中に発行した presigned URL の一覧）は sessionStorage に発行履歴（bucket / key / url / method / expiresAt）を保持して実現する。S3 側に presign の痕跡は残らないため、これ以外の列挙手段は無い。ページ再読み込みで履歴は消える。key が変わる操作（rename / move）と削除のあとは記録を落とす（presign は key に対する署名なので、key が変われば必ず 404 になる）
- TTL 有効時は各ファイルの有効期限を一覧に表示する
- design system: db-portal（BSI）の design system を使う。色は BSI 紫（`#6F4392`）
- i18n: ja / en。言語解決は localStorage ベース（初回は `navigator.language` から推定、`?lang=ja|en` の URL hint で明示切替。hint は localStorage へ永続化して URL から除去する）
- package manager: npm

## SeaweedFS 由来の制約

pin を上げるときはこの表の各項目を再検証する（[operations.md](./operations.md) の「SeaweedFS の pin」）。詳細は括弧内の節を参照。

| 制約 | 影響する節 |
| --- | --- |
| IAM policy engine は nested claim を扱えず、STS session 経由では配列 claim が文字列に潰れる | 原則 / 認証・認可 |
| STS signing key は決定論的な固定鍵が必須（無いと起動失敗） | 認証・認可 |
| `DurationSeconds` の上限 43200s (12h) が固定値で、presigned URL の寿命は STS session に cap される | presign |
| STS session は元の access token の有効期限で頭打ちになる（この挙動は version に依存する。[operations.md](./operations.md) の「SeaweedFS の pin」） | presign |
| per-bucket quota は超過で bucket を read-only にし、write を HTTP 500 で拒否する（filer の 507 が S3 層で潰れる） | quota と TTL の実現 |
| bucket の quota 設定値を読む S3 API が無い | quota と TTL の実現 / frontend |
| 初回 PUT による bucket の auto-create は admin 権限限定で、STS 認証のユーザーには効かない | 配置 |
| bucket 作成時に S3 の bucket 命名規則を強制する | 配置 |
| master は volume 1 本のサイズ上限に 30720 MB (30 GiB) の天井を持つ | operations.md デプロイ構成 |
| 認可エンジンは一部の bucket 操作（CreateBucket 等）を細粒度 action に解決しない | 認証・認可 |
| `ListMultipartUploads` が `Initiated` を返さず、`IsTruncated` と marker が食い違うことがある | frontend / operations.md 日次運用タスク |
| 新規 collection（= bucket）への書き込みは default で volume を 7 本確保する | operations.md デプロイ構成 |
| filer API（HTTP / gRPC）には S3 IAM の認可が効かない | 認証・認可 / ドメインと routing |
