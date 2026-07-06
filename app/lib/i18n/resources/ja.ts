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
  }
  upload: {
    button: string
    dropHint: string
    done: string
    failed: string
    resume: string
    mismatch: string
    cancelFailed: string
  }
  pendingUploads: {
    title: string
    uploadedInfo: string
    pickToResume: string
    discard: string
    discardConfirmTitle: string
    discardConfirmBody: string
    discardFailed: string
  }
  publish: {
    badge: string
    title: string
    toggleAriaLabel: string
    loading: string
    publicUrlLabel: string
    makePublicIntro: string
    makePublic: string
    isPublicIntro: string
    makePrivate: string
    failed: string
  }
  presign: {
    getTitle: string
    putTitle: string
    expiresLabel: string
    minutes15: string
    hour1: string
    issue: string
    urlLabel: string
    expiresAt: string
    note: string
    filenameLabel: string
    putUsage: string
    failed: string
  }
  shell: {
    skipToContent: string
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
    prepareErrorTitle: string
    unsupportedUsernameTitle: string
    unsupportedUsernameBody: string
  }
  browse: {
    pageTitle: string
    pageDescription: string
    root: string
    breadcrumbLabel: string
    fileListLabel: string
    empty: string
    emptyTitle: string
    expiresAt: string
    download: string
    downloadFailed: string
    delete: string
    loadMore: string
    listErrorTitle: string
    deleteConfirmTitle: string
    deleteConfirmBody: string
    deleteErrorTitle: string
  }
  landing: {
    eyebrow: string
    heroLead: string
    useCasesTitle: string
    uploadTitle: string
    uploadBody: string
    downloadTitle: string
    downloadBody: string
    publishTitle: string
    publishBody: string
    presignTitle: string
    presignBody: string
  }
}

export const ja: Resources = {
  common: {
    loading: "読み込み中…",
    cancel: "キャンセル",
    retry: "再試行",
    close: "閉じる",
    copy: "コピー",
    copied: "コピーしました",
  },
  upload: {
    button: "アップロード",
    dropHint: "ここにドロップしてアップロード",
    done: "アップロード完了",
    failed: "アップロードに失敗しました",
    resume: "再開",
    mismatch: "選択したファイルは中断したアップロードと一致しません",
    cancelFailed: "キャンセルに失敗しました。アップロードはサーバーに残っている可能性があります",
  },
  pendingUploads: {
    title: "再開待ちのアップロード",
    uploadedInfo: "{{size}} アップロード済み・最終 {{datetime}}",
    pickToResume: "ファイルを選んで再開",
    discard: "破棄",
    discardConfirmTitle: "アップロードを破棄",
    discardConfirmBody: "{{name}} の中断したアップロードを破棄します。アップロード済みの部分は失われます。",
    discardFailed: "破棄に失敗しました",
  },
  publish: {
    badge: "公開中",
    title: "公開設定",
    toggleAriaLabel: "{{name}} の公開状態を切り替える",
    loading: "公開状態を確認中…",
    publicUrlLabel: "公開 URL",
    makePublicIntro: "{{name}} を公開します。次の URL で誰でも認証なしでダウンロードできるようになります。",
    makePublic: "公開する",
    isPublicIntro: "{{name}} は公開中です。次の URL で誰でもダウンロードできます。",
    makePrivate: "公開停止",
    failed: "公開状態の変更に失敗しました",
  },
  presign: {
    getTitle: "共有 URL を発行",
    putTitle: "アップロード用 URL を発行",
    expiresLabel: "有効期間",
    minutes15: "15 分",
    hour1: "1 時間",
    issue: "発行",
    urlLabel: "presigned URL",
    expiresAt: "{{datetime}} 頃まで有効",
    note: "presigned URL は短期の受け渡し用です。発行に使うセッションの残り時間で頭打ちになるため、実効上限は約 1 時間です。長期の共有には公開を使ってください。",
    filenameLabel: "ファイル名",
    putUsage: "この URL に対して HTTP PUT でアップロードできます。",
    failed: "URL の発行に失敗しました",
  },
  shell: {
    skipToContent: "本文へスキップ",
    tagline: "ファイルサーバー",
    login: "ログイン",
    logout: "ログアウト",
  },
  switchLang: {
    label: "言語切替",
    toJa: "日本語",
    toEn: "English",
  },
  auth: {
    loginRequired: "kura を利用するには DDBJ アカウントでログインしてください。",
    processingCallback: "ログイン処理中…",
    errorTitle: "ログインに失敗しました",
    backToTop: "トップへ戻る",
  },
  bucket: {
    preparing: "領域を準備中…",
    prepareErrorTitle: "領域の準備に失敗しました",
    unsupportedUsernameTitle: "このユーザー名では kura を利用できません",
    unsupportedUsernameBody:
      "ユーザー名 {{username}} は S3 バケット命名規則 (小文字英数と . - のみ、3-63 文字、先頭末尾は英数字) に適合しないため、kura の領域を作成できません。",
  },
  browse: {
    pageTitle: "マイファイル",
    pageDescription: "アップロードしたファイルの一覧です。ダウンロード・公開・共有 URL の発行をここから行います。ファイルはドラッグ&ドロップでも追加できます。",
    root: "ホーム",
    breadcrumbLabel: "現在のパス",
    fileListLabel: "ファイル一覧",
    empty: "ファイルはまだありません。",
    emptyTitle: "ファイルがありません",
    expiresAt: "有効期限",
    download: "ダウンロード",
    downloadFailed: "ダウンロード URL の発行に失敗しました",
    delete: "削除",
    loadMore: "さらに表示",
    listErrorTitle: "一覧の取得に失敗しました",
    deleteConfirmTitle: "ファイルを削除",
    deleteConfirmBody: "{{name}} を削除します。この操作は取り消せません。",
    deleteErrorTitle: "削除に失敗しました",
  },
  landing: {
    eyebrow: "DDBJ / NIG",
    heroLead: "大容量ファイルを、認証付きで安全にやり取りするための場所です。",
    useCasesTitle: "できること",
    uploadTitle: "アップロード",
    uploadBody: "ログインすると、100 GB クラスのファイルもそのままアップロードできます。",
    downloadTitle: "ダウンロード",
    downloadBody: "アップロードしたファイルは一覧からいつでもダウンロードできます。",
    publishTitle: "公開",
    publishBody: "特定のファイルを、誰でも認証なしでダウンロードできる状態にできます。",
    presignTitle: "共有 URL の発行",
    presignBody: "期限付きの URL を発行し、短期間だけファイルを受け渡しできます。",
  },
}
