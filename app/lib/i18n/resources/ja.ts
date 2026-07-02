// ja が Resources 型の SSOT。en.ts は同じ型で実体を定義することで、キー集合の
// 一致がコンパイル時に強制される (欠落・過剰キーは型エラー)。
export type Resources = {
  common: {
    loading: string
    cancel: string
    retry: string
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
    download: "ダウンロード",
    delete: "削除",
    loadMore: "さらに表示",
    listErrorTitle: "一覧の取得に失敗しました",
    deleteConfirmTitle: "ファイルを削除",
    deleteConfirmBody: "{{name}} を削除します。この操作は取り消せません。",
    deleteErrorTitle: "削除に失敗しました",
  },
}
