declare module "@fontsource-variable/noto-sans-jp"

// File System Access API の保存ダイアログ。lib.dom にはまだ含まれていない。
// 使えるかどうかで zip の書き出し方 (直接ストリーム / メモリ経由) が変わるので、
// optional のまま宣言して呼び出し側で存在を確かめる。
interface SaveFilePickerType {
  description?: string
  accept: Record<string, string[]>
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: SaveFilePickerType[]
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
}
