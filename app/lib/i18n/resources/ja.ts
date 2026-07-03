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
    button: string
    badge: string
    title: string
    loading: string
    publicUrlLabel: string
    makePublicIntro: string
    makePublic: string
    isPublicIntro: string
    makePrivate: string
    failed: string
  }
  presign: {
    button: string
    putButton: string
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
    root: string
    breadcrumbLabel: string
    empty: string
    name: string
    size: string
    lastModified: string
    expiresAt: string
    download: string
    delete: string
    loadMore: string
    listErrorTitle: string
    deleteConfirmTitle: string
    deleteConfirmBody: string
    deleteErrorTitle: string
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
    button: "公開",
    badge: "公開中",
    title: "公開設定",
    loading: "公開状態を確認中…",
    publicUrlLabel: "公開 URL",
    makePublicIntro: "{{name}} を公開します。次の URL で誰でも認証なしでダウンロードできるようになります。",
    makePublic: "公開する",
    isPublicIntro: "{{name}} は公開中です。次の URL で誰でもダウンロードできます。",
    makePrivate: "公開停止",
    failed: "公開状態の変更に失敗しました",
  },
  presign: {
    button: "共有",
    putButton: "アップロード用 URL",
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
    root: "ホーム",
    breadcrumbLabel: "現在のパス",
    empty: "ファイルはまだありません。",
    name: "名前",
    size: "サイズ",
    lastModified: "更新日時",
    expiresAt: "有効期限",
    download: "ダウンロード",
    delete: "削除",
    loadMore: "さらに表示",
    listErrorTitle: "一覧の取得に失敗しました",
    deleteConfirmTitle: "ファイルを削除",
    deleteConfirmBody: "{{name}} を削除します。この操作は取り消せません。",
    deleteErrorTitle: "削除に失敗しました",
  },
}
