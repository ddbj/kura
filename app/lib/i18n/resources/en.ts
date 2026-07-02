import type { Resources } from "./ja"

export const en: Resources = {
  common: {
    loading: "Loading…",
    cancel: "Cancel",
    retry: "Retry",
  },
  shell: {
    skipToContent: "Skip to content",
    tagline: "File server",
    login: "Log in",
    logout: "Log out",
  },
  switchLang: {
    label: "Switch language",
    toJa: "日本語",
    toEn: "English",
  },
  auth: {
    loginRequired: "Log in with your DDBJ account to use kura.",
    processingCallback: "Signing in…",
    errorTitle: "Sign-in failed",
    backToTop: "Back to top",
  },
  bucket: {
    preparing: "Preparing your storage…",
    prepareErrorTitle: "Failed to prepare your storage",
    unsupportedUsernameTitle: "kura is not available for this username",
    unsupportedUsernameBody:
      "The username {{username}} does not conform to the S3 bucket naming rules (lowercase letters, digits, . and - only; 3-63 characters; must start and end with a letter or digit), so a kura storage area cannot be created.",
  },
  browse: {
    root: "Home",
    breadcrumbLabel: "Current path",
    empty: "No files yet.",
    name: "Name",
    size: "Size",
    lastModified: "Last modified",
    download: "Download",
    delete: "Delete",
    loadMore: "Load more",
    listErrorTitle: "Failed to list files",
    deleteConfirmTitle: "Delete file",
    deleteConfirmBody: "{{name}} will be deleted. This cannot be undone.",
    deleteErrorTitle: "Failed to delete",
  },
}
