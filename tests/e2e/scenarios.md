# E2E シナリオ

E2E で扱うのは、実ブラウザと実 Keycloak を通さないと証明できないことだけである。シナリオ ID は `test(...)` 名と 1:1 なので、ID を grep すれば実装に辿り着く。走らせ方と前提は [../README.md](../README.md)。

## ペルソナ

- **P-ANON**: 未認証。cookie も storage も空の fresh context で開く
- **P-USER**: staging Keycloak にログイン済み。`preferred_username` がそのまま自分の bucket 名になる

## 状態の分離

全 test が 1 つの bucket を共有するため、並列実行はしない。ファイルは必ず runId 配下の prefix に置き、spec ファイルの開始時・各 test の前後で自分の scope だけを掃除する（他の runId には触らない）。掃除は S3 SDK を直接叩いて行う。UI 経由の bulk delete は副作用があり遅い。過去の run の残骸は `scripts/e2e-cleanup.ts` で手動掃除する。

Playwright の `storageState()` は cookie と localStorage しか保存しない。oidc-client-ts は token を sessionStorage に置くので、認証状態の再利用には sessionStorage の snapshot を別ファイルに保存して注入する必要がある。

logout は Keycloak の server-side session を落とす。主テストユーザーの storageState で logout すると、以降その storageState を使う test の silent renew が全て失敗する。したがって logout のシナリオは専用ユーザーか fresh login で行う。

SeaweedFS の書き込みは ListObjectsV2 への反映が遅れることがある（通常 1 秒未満）。空状態を主張するシナリオは auto-retry の timeout で吸収する。

## AUTH

PKCE の redirect、Keycloak のログインフォーム、callback からの復帰は実 IdP を通さないと成立しない。

| ID | 証明すること |
| --- | --- |
| S-AUTH-01 | 未認証で `/` を開くと LoginBox が出る（Header は描画されない） |
| S-AUTH-02 | ログインボタンが PKCE（S256）の認可 request で Keycloak へ飛ばす |
| S-AUTH-03 | 保存済みの認証状態で `/` を開くと Header まで復元される |
| S-AUTH-04 | SPA 起動時に自分の bucket への HeadBucket が発行される |
| S-AUTH-05 | fresh login から logout して LoginBox に戻る |
| E-AUTH-01 | callback の `error=access_denied` がエラー表示になる |
| E-AUTH-02 | callback のエラー画面から `/` に戻ってもエラー Callout が残る |
| E-AUTH-03 | 未認証で SPA route を叩くと LoginBox に落ち、ログイン後に元の URL へ戻る |
| E-AUTH-04 | 領域の初期化に失敗するとエラー Callout が出る |

## SHELL

実 UA の focus 移動とクリックの伝播、リロードをまたぐ言語の永続化を見る。

| ID | 証明すること |
| --- | --- |
| S-SHELL-01 | Header の wordmark で `/` に戻る |
| S-SHELL-02 | UserMenu が開閉し、外側クリックで閉じる |
| S-SHELL-03 | UserMenu を Escape で閉じると focus が trigger に戻る |
| S-SHELL-04 | 言語切替が browse 画面まで波及する |
| S-SHELL-05 | `?lang=en` の URL hint が効き、URL から除去される |

## BROWSE

history と URL 直打ちの挙動は、SPA fallback を含む実配信の上でしか確かめられない。

| ID | 証明すること |
| --- | --- |
| S-BROWSE-01 | 空の prefix が empty state になる |
| S-BROWSE-02 | 新規フォルダの `.keep` は一覧に出ず、folder 行だけが見える |
| S-BROWSE-03 | フォルダに入ると breadcrumb が延びる |
| S-BROWSE-04 | 中間の breadcrumb で親に戻る |
| S-BROWSE-05 | ブラウザの戻る / 進むが SPA の history と整合する |
| S-BROWSE-06 | 深い prefix の URL 直打ちで遷移できる |
| E-BROWSE-01 | 存在しない prefix は空フォルダとして表示される |

## TOOLBAR

| ID | 証明すること |
| --- | --- |
| S-TOOLBAR-01 | 検索が substring 一致で絞り込む |
| S-TOOLBAR-02 | ヒット 0 の表示から「検索をクリア」で復帰する |
| S-TOOLBAR-04 | 「期限つき」レンズが presign 済みのファイルだけを出す |
| S-TOOLBAR-05 | sort カラムで並び順が変わる |
| S-TOOLBAR-06 | 使用量メーターが表示される |

## UPLOAD

file input・drag & drop・フォルダ選択は、実 UA の File API を通さないと再現できない。

| ID | 証明すること |
| --- | --- |
| S-UPLOAD-01 | メニューの「ファイルを選択」で単一ファイルを upload できる |
| S-UPLOAD-02 | 空状態の primary button から upload できる |
| S-UPLOAD-03 | drag & drop で upload できる |
| S-UPLOAD-04 | 「フォルダを選択」でサブフォルダ込みの upload ができる |
| S-UPLOAD-05 | 実行中の upload を行の「キャンセル」で止められる |
| S-UPLOAD-06 | 「すべてキャンセル」で実行中の upload をまとめて止められる |
| E-UPLOAD-01 | 同名衝突をスキップできる |
| E-UPLOAD-02 | 同名衝突を上書きできる |
| E-UPLOAD-03 | 同名衝突を別名で保存できる |
| E-UPLOAD-04 | 失敗した upload を「再試行」でやり直せる |

## RESUME

中断はネットワーク層で起こすしかなく、リロードやセッション取り直しをまたぐ復元は実ブラウザでしか再現できない。

| ID | 証明すること |
| --- | --- |
| S-RESUME-01 | 同一セッション内で中断した upload を再開し、byte が一致する |
| S-RESUME-02 | 別 context で再ログインしても「再開待ち」から復元できる |
| S-RESUME-03 | リロード後に「再開待ち」から復元できる |
| E-RESUME-01 | 同一サイズで内容の違うファイルでの再開が拒否される |
| E-RESUME-02 | 再開待ちの upload を「破棄」で消せる |

## DOWNLOAD

download の受け取りと zip の組み立てはブラウザ API に依存する。

| ID | 証明すること |
| --- | --- |
| S-DOWNLOAD-01 | 行メニューの「ダウンロード」で byte が一致する |
| S-DOWNLOAD-02 | unicode・space・`%`・`?`・`#` を含む key を download できる |
| S-DOWNLOAD-03 | 複数選択を zip にまとめて download できる |
| S-DOWNLOAD-04 | フォルダを zip で download でき、相対パスと空フォルダが保たれる |

## PRESIGN

発行したリンクが未認証の相手から実際に引けることは、2 つの context を使う実ブラウザでしか示せない。

| ID | 証明すること |
| --- | --- |
| S-PRESIGN-01 | 発行したリンクが badge と panel に出て、未認証 context から byte が一致する |
| S-PRESIGN-02 | TTL の 3 択と表示される失効時刻が対応する |
| S-PRESIGN-03 | rename すると発行済みの記録が落ちる |
| S-PRESIGN-04 | 削除すると発行済みの記録が落ちる |

## FILEOPS

モーダル経由の操作と、その後の一覧の整合を UI 層で固定する。

| ID | 証明すること |
| --- | --- |
| S-FILEOPS-01 | ファイルの rename |
| S-FILEOPS-02 | フォルダの rename |
| S-FILEOPS-03 | FolderPicker 経由のファイルの move |
| S-FILEOPS-04 | ファイルの copy |
| S-FILEOPS-05 | 単一削除（確認モーダルと初期 focus を含む） |
| S-FILEOPS-06 | 選択バー経由の複数削除 |
| S-FILEOPS-07 | フォルダの削除 |
| S-FILEOPS-08 | フォルダの move |
| S-FILEOPS-09 | 新規フォルダの作成 |
| E-FILEOPS-01 | rename の名前衝突が拒否される |
| E-FILEOPS-02 | 元と同じ名前での rename が拒否される |
| E-FILEOPS-03 | `/` を含む名前が拒否される |
| E-FILEOPS-04 | フォルダを自身の中へ move できない（picker 上で disabled になる） |
| E-FILEOPS-05 | 空の名前での submit が拒否される |

## FLOW

| ID | 証明すること |
| --- | --- |
| S-FLOW-01 | upload から期限つきリンクの発行まで通し、未認証で 200 と byte 一致が得られる |

## E2E でやらないこと

以下は他の層が担保する。E2E に書くと重複するか、deterministic に書けない。

- IAM 境界の網羅（他 bucket の拒否 / admin role / audience / exp）: integration の IAM boundary test。SPA に他 bucket へ向かう経路が無い
- quota 超過とその回復、日次運用タスクの挙動: integration。UI 側の表示は unit
- resume ロジック本体（MD5 照合 / part 分割 / abort）: integration と unit
- key encoding、bucket 名の判定、i18n の parity、設定値の受理集合: unit と PBT
- 利用できない username の画面: unit。staging に `_` 入りの username を用意できない
- silent renew の発火: token の失効時刻を外から動かせず、実 flow を deterministic に観測できない。unit が renew のロジックを担保し、長時間セッションの継続は配備時の実測で見る
- SPA 配信の形（fallback / asset の 404 / Host 検証 / CORS に触らないこと）: integration
- CORS の preflight: 通常フローの成功が暗黙に担保する（block されれば S3 操作自体が失敗する）
- 大容量ファイル（100 GB クラス、1 時間超の upload、実サイズのストリーミング）: 配備時の実測（[../../docs/deployment.md](../../docs/deployment.md) の「配備先での実測」）

## trace の扱い

Playwright の trace には storageState と `page.evaluate` の戻り値が入るため、access token / refresh token が平文で残る。trace はホストの `test-results/`（git 管理外）に留め、artifact として外に出さない。`.auth/` の認証状態も同様に外に出さない。
