# E2E シナリオ

E2E で扱うのは、実際のブラウザと実際の Keycloak を通さないと確かめられないことだけである。シナリオ ID は `test(...)` に渡すテスト名と 1 対 1 に対応するので、ID で grep すると実装が見つかる。実行方法と前提は [../README.md](../README.md) にある。

## ペルソナ

- P-ANON: 未認証の利用者。テストは、cookie も storage も空の新しい browser context でページを開く
- P-USER: staging の Keycloak にログイン済みの利用者。`preferred_username` がそのまま自分の bucket 名になる

## 状態の分離

全 test が 1 つの bucket を共有するので、test は並列に実行しない。各 test は、ファイルを必ず実行ごとの ID（runId）の下の prefix に置く。spec ファイルの開始時と各 test の前後に、自分の scope だけを掃除する。他の runId の下の object には一切アクセスしない。掃除には S3 SDK を直接使う。UI から一括削除すると副作用があり、遅いためである。過去の実行で残ったファイルは、`scripts/e2e-cleanup.ts` を手で実行して削除する。

Playwright の `storageState()` は、cookie と localStorage しか保存しない。oidc-client-ts は token を sessionStorage に置くので、認証状態を再利用するには、sessionStorage の snapshot を別のファイルに保存し、test の開始時にページへ入れ直す必要がある。

logout すると、Keycloak の server-side の session が無効になる。主テストユーザーの storageState で logout すると、それ以降に同じ storageState を使う test の silent renew がすべて失敗する。したがって、logout のシナリオは、logout 専用のユーザーか、その場でのログイン（fresh login）で行う。

SeaweedFS への書き込みが ListObjectsV2 の結果に出るまでに、遅れが出ることがある（通常は 1 秒未満）。一覧が空であることを確かめるシナリオでは、Playwright の auto-retry の timeout の間に一覧が空になるのを待つ。

## AUTH

PKCE の redirect、Keycloak のログインフォーム、callback からの復帰は、実際の IdP を通さないと成立しない。

| ID | 確かめること |
| --- | --- |
| S-AUTH-01 | 未認証で `/` を開くと LoginBox が出る（Header は描画されない） |
| S-AUTH-02 | ログインボタンを押すと、PKCE（S256）の認可 request で Keycloak へ遷移する |
| S-AUTH-03 | 保存済みの認証状態で `/` を開くと、Header まで復元される |
| S-AUTH-04 | SPA の起動時に、自分の bucket への HeadBucket が発行される |
| S-AUTH-05 | fresh login から logout して、LoginBox に戻る |
| E-AUTH-01 | callback の `error=access_denied` がエラー表示になる |
| E-AUTH-02 | callback のエラー画面から `/` に戻っても、エラー Callout が残る |
| E-AUTH-03 | 未認証で SPA の route を開くと LoginBox が出て、ログイン後に元の URL へ戻る |
| E-AUTH-04 | 領域（自分の bucket）の初期化に失敗すると、エラー Callout が出る |

## SHELL

実際のブラウザでの focus の移動とクリックの伝播、リロードしたあとも言語の設定が残ることを確かめる。

| ID | 確かめること |
| --- | --- |
| S-SHELL-01 | Header の wordmark で `/` に戻る |
| S-SHELL-02 | UserMenu が開閉し、外側をクリックすると閉じる |
| S-SHELL-03 | UserMenu を Escape で閉じると、focus が trigger に戻る |
| S-SHELL-04 | 言語の切り替えが browse 画面にも反映される |
| S-SHELL-05 | `?lang=en` の URL hint で言語が切り替わり、`?lang=en` が URL から除去される |

## BROWSE

history と、URL を直接入力したときの挙動は、SPA fallback を含む実際の配信でしか確かめられない。

| ID | 確かめること |
| --- | --- |
| S-BROWSE-01 | 空の prefix で empty state が表示される |
| S-BROWSE-02 | 新規フォルダの `.keep` は一覧に出ず、folder 行だけが見える |
| S-BROWSE-03 | フォルダに入ると、breadcrumb にフォルダが追加される |
| S-BROWSE-04 | 途中の breadcrumb で親のフォルダに戻る |
| S-BROWSE-05 | ブラウザの戻る / 進むで、SPA の history と同じ画面に移る |
| S-BROWSE-06 | 深い prefix の URL を直接入力して遷移できる |
| E-BROWSE-01 | 存在しない prefix は空フォルダとして表示される |

## TOOLBAR

| ID | 確かめること |
| --- | --- |
| S-TOOLBAR-01 | 検索が部分文字列の一致で一覧を絞り込む |
| S-TOOLBAR-02 | 検索結果が 0 件の表示から、「検索をクリア」で元の一覧に戻る |
| S-TOOLBAR-04 | 「期限つき」レンズが、presign 済みのファイルだけを表示する |
| S-TOOLBAR-05 | sort のカラムで並び順が変わる |
| S-TOOLBAR-06 | 使用量メーターが表示される |

## UPLOAD

file input・drag & drop・フォルダ選択は、実際のブラウザの File API を通さないと再現できない。

| ID | 確かめること |
| --- | --- |
| S-UPLOAD-01 | メニューの「ファイルを選択」で、単一のファイルを upload できる |
| S-UPLOAD-02 | 空状態の primary button から upload できる |
| S-UPLOAD-03 | drag & drop で upload できる |
| S-UPLOAD-04 | 「フォルダを選択」で、サブフォルダを含めて upload できる |
| S-UPLOAD-05 | 実行中の upload を、行の「キャンセル」で止められる |
| S-UPLOAD-06 | 「すべてキャンセル」で、実行中の upload をまとめて止められる |
| E-UPLOAD-01 | 同名のファイルとの衝突で、upload をスキップできる |
| E-UPLOAD-02 | 同名のファイルとの衝突で、上書きできる |
| E-UPLOAD-03 | 同名のファイルとの衝突で、別名で保存できる |
| E-UPLOAD-04 | 失敗した upload を「再試行」でやり直せる |

## RESUME

upload の中断はネットワーク層で起こすしかない。リロードや認証セッションの取り直しのあとに upload を復元する動作は、実際のブラウザでしか再現できない。

| ID | 確かめること |
| --- | --- |
| S-RESUME-01 | 同じセッションの中で中断した upload を再開でき、upload したファイルの byte が元のファイルと一致する |
| S-RESUME-02 | 別の browser context で再ログインしても、「再開待ち」から upload を復元できる |
| S-RESUME-03 | リロードしたあとに、「再開待ち」から upload を復元できる |
| E-RESUME-01 | サイズが同じで内容が違うファイルでの再開が拒否される |
| E-RESUME-02 | 再開待ちの upload を「破棄」で消せる |

## DOWNLOAD

download の受け取りと zip の組み立ては、ブラウザの API に依存する。

| ID | 確かめること |
| --- | --- |
| S-DOWNLOAD-01 | 行メニューの「ダウンロード」で取得したファイルの byte が、元のファイルと一致する |
| S-DOWNLOAD-02 | unicode・space・`%`・`?`・`#` を含む key を download できる |
| S-DOWNLOAD-03 | 複数選択したファイルを、1 つの zip にまとめて download できる |
| S-DOWNLOAD-04 | フォルダを zip で download でき、zip の中で相対パスと空フォルダが保たれる |

## PRESIGN

発行したリンクから未認証の相手が実際にファイルを取得できることは、2 つの browser context を使う実際のブラウザでしか確かめられない。

| ID | 確かめること |
| --- | --- |
| S-PRESIGN-01 | 発行したリンクが badge と panel に表示され、未認証の context でリンクから取得したファイルの byte が元のファイルと一致する |
| S-PRESIGN-02 | 有効期間（TTL）の 3 つの選択肢と、表示される失効時刻が対応する |
| S-PRESIGN-03 | rename すると、発行済みのリンクの記録が消える |
| S-PRESIGN-04 | 削除すると、発行済みのリンクの記録が消える |

## FILEOPS

モーダルを使う操作と、操作したあとの一覧が操作の結果と一致することを、UI の層で確かめ、回帰を防ぐ。

| ID | 確かめること |
| --- | --- |
| S-FILEOPS-01 | ファイルの rename |
| S-FILEOPS-02 | フォルダの rename |
| S-FILEOPS-03 | FolderPicker を使ったファイルの move |
| S-FILEOPS-04 | ファイルの copy |
| S-FILEOPS-05 | 単一の削除（確認モーダルと初期 focus を含む） |
| S-FILEOPS-06 | 選択バーを使った複数の削除 |
| S-FILEOPS-07 | フォルダの削除 |
| S-FILEOPS-08 | フォルダの move |
| S-FILEOPS-09 | 新規フォルダの作成 |
| E-FILEOPS-01 | rename で名前が衝突すると拒否される |
| E-FILEOPS-02 | 元と同じ名前での rename が拒否される |
| E-FILEOPS-03 | `/` を含む名前が拒否される |
| E-FILEOPS-04 | フォルダを自分自身の中へ move できない（picker 上で disabled になる） |
| E-FILEOPS-05 | 空の名前での submit が拒否される |

## FLOW

| ID | 確かめること |
| --- | --- |
| S-FLOW-01 | upload から期限つきリンクの発行までを続けて行い、未認証の context でリンクから HTTP 200 と、元のファイルと一致する byte が得られる |

## E2E で確かめないこと

次の項目は、E2E 以外のテストか、配備時の実測で確かめる。E2E で書くと、他のテストと重複するか、決まった結果になるように書けない。

- IAM の境界の網羅（他の bucket の拒否 / admin role / audience / exp）: integration の IAM boundary のテストで確かめる。SPA には、他の bucket にアクセスする操作が無い
- quota の超過とその回復、日次運用タスクの挙動: integration で確かめる。UI 側の表示は unit で確かめる
- resume のロジック本体（MD5 照合 / part の分割 / abort）: integration と unit で確かめる
- key の encoding、bucket 名の判定、i18n の ja と en の対応、ビルド時の設定として受け付ける値の集合: unit と PBT で確かめる
- 利用できない username（`_` を含む username など）の画面: unit で確かめる。staging に `_` を含む username を用意できない
- silent renew の発火: テストからは token の失効時刻を動かせないので、実際の flow を決まった結果になるように観測できない。renew のロジックは unit で確かめ、長時間のセッションが続くことは配備時の実測で確かめる
- SPA の配信（fallback / asset の 404 / Host の検証 / 配信 server が CORS の header を付けないこと）: integration で確かめる
- CORS の preflight: 通常の操作が成功することで、間接的に確かめられる（preflight が block されれば、S3 の操作そのものが失敗する）
- 大容量ファイル（100 GB クラス、1 時間を超える upload、実際のサイズでのストリーミング）: 配備時の実測で確かめる（[../../docs/deployment.md](../../docs/deployment.md) の「7. 配備先での実測」）

## trace の扱い

Playwright の trace には storageState と `page.evaluate` の戻り値が入るので、access token と refresh token が平文で残る。trace は、ホストの `test-results/`（git 管理外）に置いたままにし、artifact として外に出さない。`.auth/` の認証状態も、同じく外に出さない。
