// ja が Resources 型の SSOT。en.ts は同じ型で実体を定義することで、キー集合の
// 一致がコンパイル時に強制される (欠落・過剰キーは型エラー)。
export type Resources = {
  common: {
    loading: string
    cancel: string
    retry: string
    close: string
    copy: string
    copied: string
    delete: string
    open: string
    checking: string
  }
  shell: {
    tagline: string
    login: string
    logout: string
  }
  switchLang: {
    label: string
    toJa: string
    toEn: string
  }
  auth: {
    loginRequired: string
    processingCallback: string
    errorTitle: string
    backToTop: string
  }
  bucket: {
    preparing: string
    unsupportedUsernameTitle: string
    unsupportedUsernameBody: string
  }
  duration: {
    lessThanMinute: string
    minutes: string
    hours: string
    hoursMinutes: string
  }
  browse: {
    newFolder: string
    upload: string
    chooseFile: string
    chooseFolder: string
    searchPlaceholder: string
    lensAll: string
    lensTimed: string
    quotaLabel: string
    colName: string
    colShare: string
    colSize: string
    colUpdated: string
    colUpdatedWithTtl: string
    selectAll: string
    selectRow: string
    rowActions: string
    selectedCount: string
    clearSelection: string
    issueLink: string
    emptyTitle: string
    emptyBodyUpload: string
    emptyBodyDrop: string
    searchNoMatch: string
    clearSearch: string
    noTimedLinks: string
    showAll: string
    openFolder: string
    openUrl: string
    timedTag: string
    menuCopyLink: string
    menuDownload: string
    menuDownloadZip: string
    menuRename: string
    menuMove: string
    menuCopy: string
    menuDelete: string
    presignPanelLabel: string
    ttlRemaining: string
    dropHint: string
  }
  notice: {
    bucketInitFailed: string
    overQuota: string
    listFailed: string
    downloadFailed: string
    copyFailed: string
    linkCopied: string
    resumeBlocked: string
    resumeStarted: string
    resumeFailed: string
    discarded: string
    discardFailed: string
    zipTooLarge: string
  }
  pendingUploads: {
    title: string
    count: string
    resume: string
    discard: string
  }
  transfers: {
    kindUpload: string
    kindDownload: string
    kindDelete: string
    kindFolderDelete: string
    kindRename: string
    kindMove: string
    kindFolderMove: string
    kindCopy: string
    kindFolderRename: string
    runningUpload: string
    runningDownload: string
    runningDelete: string
    runningFolderDelete: string
    runningRename: string
    runningMove: string
    runningFolderMove: string
    runningCopy: string
    runningFolderRename: string
    fallbackLabel: string
    inProgress: string
    header: string
    cancelAll: string
    colName: string
    colState: string
    colProgress: string
    colDetail: string
    colActions: string
    stateRunning: string
    stateQueued: string
    stateFailed: string
    stateConflict: string
    statePaused: string
    stateDone: string
    detailMismatch: string
    detailCancelled: string
    detailError: string
    detailConflict: string
    detailCount: string
    actionOverwrite: string
    actionSaveAs: string
    actionSkip: string
    targetsCount: string
    deleteFailedCount: string
    moveFailedCount: string
  }
  share: {
    title: string
    ttlLabel: string
    ttl15: string
    ttl60: string
    ttlMax: string
    notice: string
    noticeMax: string
    issue: string
    issuing: string
    retryFailed: string
    retrying: string
    statusIssuing: string
    statusDone: string
    statusFailed: string
    failedPrefix: string
    expiresAt: string
  }
  modal: {
    renameTitle: string
    renameInput: string
    renameSubmit: string
    folderRenameTitle: string
    copyTitle: string
    copyInput: string
    copySuffix: string
    copySuffixNumbered: string
    newFolderTitle: string
    newFolderInput: string
    newFolderSubmit: string
    newFolderBusy: string
    moveTitle: string
    moveFrom: string
    moveTo: string
    moveChoose: string
    moveSubmit: string
    folderMoveTitle: string
    folderMoveNote: string
    deleteTitle: string
    deleteBodyOne: string
    deleteBodyMany: string
    folderDeleteTitle: string
    folderDeleteBody: string
    pickerTitle: string
    pickerSubmit: string
    pickerLoading: string
    pickerError: string
    pickerEmpty: string
    pickerCannotMove: string
    nameRequired: string
    folderNameRequired: string
    noSlash: string
    folderNoSlash: string
    sameName: string
    alreadyExists: string
    destSame: string
    destAlreadyExists: string
    intoSelf: string
  }
}

export const ja: Resources = {
  common: {
    loading: "読み込み中…",
    cancel: "キャンセル",
    retry: "再試行",
    close: "閉じる",
    copy: "コピー",
    copied: "コピー済み",
    delete: "削除",
    open: "開く",
    checking: "確認中…",
  },
  shell: {
    tagline: "大容量ファイルの保管・共有",
    login: "DDBJ アカウントでログイン",
    logout: "ログアウト",
  },
  switchLang: {
    label: "言語切替",
    toJa: "JA",
    toEn: "EN",
  },
  auth: {
    loginRequired: "kura を利用するには DDBJ アカウントでログインしてください。",
    processingCallback: "ログイン処理中…",
    errorTitle: "ログインに失敗しました",
    backToTop: "トップへ戻る",
  },
  bucket: {
    preparing: "領域を準備中…",
    unsupportedUsernameTitle: "このユーザー名では kura を利用できません",
    unsupportedUsernameBody:
      "ユーザー名 {{username}} は S3 バケット命名規則 (小文字英数と . - のみ、3-63 文字、先頭末尾は英数字) に適合しないため、kura の領域を作成できません。",
  },
  duration: {
    lessThanMinute: "1 分",
    minutes: "{{minutes}} 分",
    hours: "{{hours}} 時間",
    hoursMinutes: "{{hours}} 時間 {{minutes}} 分",
  },
  browse: {
    newFolder: "＋ 新規フォルダ",
    upload: "アップロード",
    chooseFile: "ファイルを選択",
    chooseFolder: "フォルダを選択",
    searchPlaceholder: "ファイル名で絞り込み",
    lensAll: "すべて",
    lensTimed: "期限つき",
    quotaLabel: "使用量",
    colName: "名前",
    colShare: "共有",
    colSize: "サイズ",
    colUpdated: "更新日",
    colUpdatedWithTtl: "更新日 / 期限",
    selectAll: "全選択",
    selectRow: "{{name}} を選択",
    rowActions: "{{name}} の操作",
    selectedCount: "{{n}}件を選択中",
    clearSelection: "選択解除",
    issueLink: "リンクを発行",
    emptyTitle: "まだファイルがありません",
    emptyBodyUpload: "ファイル・フォルダをアップロードするとここに一覧表示されます。",
    emptyBodyDrop: "ドラッグ＆ドロップもできます。",
    searchNoMatch: "「{{query}}」に一致するファイルはありません",
    clearSearch: "検索をクリア",
    noTimedLinks: "期限つきリンクを発行したファイルはありません",
    showAll: "すべて表示",
    openFolder: "開く",
    openUrl: "URL を開く",
    timedTag: "期限つき",
    menuCopyLink: "リンクをコピー",
    menuDownload: "ダウンロード",
    menuDownloadZip: "zip でダウンロード",
    menuRename: "名前を変更",
    menuMove: "移動",
    menuCopy: "コピー",
    menuDelete: "削除",
    presignPanelLabel: "期限つきリンク — 約{{duration}}後に自動で失効します",
    ttlRemaining: "あと {{days}} 日",
    dropHint: "ここにドロップしてアップロード",
  },
  notice: {
    bucketInitFailed: "領域の初期化に失敗しました: {{message}}",
    overQuota:
      "容量が上限に達しています。新規アップロードは停止中です。ファイルを削除して空き容量ができれば自動的に再開します。ダウンロード・削除は引き続き行えます。",
    listFailed: "一覧の取得に失敗しました: {{message}}",
    downloadFailed: "ダウンロードに失敗しました: {{message}}",
    copyFailed: "コピーに失敗しました: {{message}}",
    linkCopied: "リンクをコピーしました",
    resumeBlocked: "再開できません: {{reason}}",
    resumeStarted: "再開を開始しました",
    resumeFailed: "再開に失敗しました: {{message}}",
    discarded: "破棄しました",
    discardFailed: "破棄に失敗しました: {{message}}",
    zipTooLarge: "まとめてダウンロードできるのは合計 {{limit}} までです。このブラウザはファイルへ直接書き出せないため、zip 全体をメモリに載せる必要があります。大きいデータは S3 client でダウンロードしてください。",
  },
  pendingUploads: {
    title: "再開待ちのアップロード",
    count: "{{n}}件",
    resume: "再開",
    discard: "破棄",
  },
  transfers: {
    kindUpload: "アップロード",
    kindDownload: "ダウンロード",
    kindDelete: "削除",
    kindFolderDelete: "削除",
    kindRename: "名前変更",
    kindMove: "移動",
    kindFolderMove: "移動",
    kindCopy: "コピー",
    kindFolderRename: "フォルダ名変更",
    runningUpload: "アップロード中",
    runningDownload: "ダウンロード中",
    runningDelete: "削除中",
    runningFolderDelete: "削除中",
    runningRename: "名前変更中",
    runningMove: "移動中",
    runningFolderMove: "移動中",
    runningCopy: "コピー中",
    runningFolderRename: "フォルダ名変更中",
    fallbackLabel: "操作",
    inProgress: "進行中",
    header: "{{label}} · {{active}}件処理中 · {{done}}件完了",
    cancelAll: "すべてキャンセル",
    colName: "名前",
    colState: "状態",
    colProgress: "進捗",
    colDetail: "詳細",
    colActions: "操作",
    stateRunning: "アップロード中",
    stateQueued: "待機中",
    stateFailed: "失敗",
    stateConflict: "衝突",
    statePaused: "一時停止",
    stateDone: "完了",
    detailMismatch: "内容が一致しません",
    detailCancelled: "キャンセル済み",
    detailError: "エラー発生",
    detailConflict: "同名が既に存在",
    detailCount: "{{loaded}} / {{total}} 件",
    actionOverwrite: "上書き",
    actionSaveAs: "別名で保存",
    actionSkip: "スキップ",
    targetsCount: "{{n}} 件のファイル",
    deleteFailedCount: "{{n}} 件の削除に失敗しました",
    moveFailedCount: "{{n}} 件の移動に失敗しました",
  },
  share: {
    title: "期限つきリンクを発行",
    ttlLabel: "有効期限",
    ttl15: "15分",
    ttl60: "1時間",
    ttlMax: "最長",
    notice: "リンクは約{{duration}}後に切れます。発行したあとに延長や取り消しはできません。",
    noticeMax: "「最長」はいまの認証セッションの残り時間です。リンクは約{{duration}}後に切れます。発行したあとに延長や取り消しはできません。",
    issue: "リンクを発行",
    issuing: "処理中…",
    retryFailed: "失敗した{{n}}件を再試行",
    retrying: "再試行中…",
    statusIssuing: "発行中",
    statusDone: "完了",
    statusFailed: "失敗",
    failedPrefix: "失敗: {{message}}",
    expiresAt: "{{datetime}} まで有効",
  },
  modal: {
    renameTitle: "名前を変更",
    renameInput: "新しい名前",
    renameSubmit: "変更",
    folderRenameTitle: "フォルダ名を変更",
    copyTitle: "コピーを作成",
    copyInput: "コピー後の名前",
    copySuffix: "{{stem}} のコピー{{ext}}",
    copySuffixNumbered: "{{stem}} のコピー ({{n}}){{ext}}",
    newFolderTitle: "新しいフォルダ",
    newFolderInput: "フォルダ名",
    newFolderSubmit: "作成",
    newFolderBusy: "作成中…",
    moveTitle: "ファイルを移動",
    moveFrom: "移動元",
    moveTo: "移動先",
    moveChoose: "フォルダを選ぶ",
    moveSubmit: "移動",
    folderMoveTitle: "フォルダを移動",
    folderMoveNote: "中身の件数が多い場合、移動には時間がかかります。進行状況は右下の操作カードに表示されます。",
    deleteTitle: "ファイルを削除",
    deleteBodyOne: "「{{name}}」を削除すると元には戻せません。",
    deleteBodyMany: "{{n}} 件のファイルを削除すると元には戻せません。",
    folderDeleteTitle: "フォルダを削除",
    folderDeleteBody: "フォルダ「{{name}}」とその中身がすべて削除されます。元には戻せません。",
    pickerTitle: "移動先のフォルダを選ぶ",
    pickerSubmit: "この場所を選ぶ",
    pickerLoading: "読み込み中…",
    pickerError: "取得に失敗しました",
    pickerEmpty: "サブフォルダはありません",
    pickerCannotMove: "この場所には移動できません",
    nameRequired: "名前を入力してください",
    folderNameRequired: "フォルダ名を入力してください",
    noSlash: "名前に「/」は使えません",
    folderNoSlash: "フォルダ名に「/」は使えません",
    sameName: "元の名前と同じです",
    alreadyExists: "「{{name}}」は既にあります",
    destSame: "移動先が元の場所と同じです",
    destAlreadyExists: "移動先に「{{name}}」が既にあります",
    intoSelf: "自分自身の中には移動できません",
  },
}
