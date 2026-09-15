import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3"
import { makeZip, predictLength } from "client-zip"

import { entryName } from "./keys"
import type { PrefixEntry } from "./objects"

// zip はブラウザ内で組み立てる (サーバ側に zip を作る経路は無い)。各 object の
// GetObject 応答をそのまま zip stream へ流すので、byte はバックエンドを経由しない。
// 圧縮はせず格納のみ: 対象の多くが既に圧縮済みで、再圧縮に CPU を使う利得が無い。

export type ZipEntry = {
  // bucket 内の object key
  key: string
  // zip の中でのパス。末尾が "/" のものは中身のない folder entry として扱う。
  name: string
  size: number
  lastModified: Date
}

// File System Access API が無いブラウザでは zip 全体が Blob としてメモリに載る。
// 途中でタブごと落ちると何も残らないので、その場合は発行前に断る。
export const MEMORY_ZIP_LIMIT_BYTES = 2 * 1024 ** 3

export const canStreamZipToDisk = (): boolean =>
  typeof window !== "undefined" && typeof window.showSaveFilePicker === "function"

const isFolderEntry = (entry: ZipEntry): boolean => entry.name.endsWith("/")

export const predictZipSize = (entries: readonly ZipEntry[]): number =>
  Number(predictLength(entries.map((entry) => isFolderEntry(entry)
    ? { name: entry.name, lastModified: entry.lastModified }
    : { name: entry.name, size: entry.size, lastModified: entry.lastModified })))

// ディスクへ直接書けないブラウザで、その要求を受けてよいか。
export const isZipTooLargeForMemory = (entries: readonly ZipEntry[]): boolean =>
  !canStreamZipToDisk() && predictZipSize(entries) > MEMORY_ZIP_LIMIT_BYTES

// prefix 配下の列挙結果を zip のエントリへ。.keep は folder を表すだけの marker
// なので、中身のない folder entry に置き換えて空 folder を保つ。
export const zipEntriesForPrefix = (prefix: string, listed: readonly PrefixEntry[]): ZipEntry[] =>
  listed.flatMap((entry) => {
    const relative = entry.key.slice(prefix.length)
    const lastModified = entry.lastModified ?? new Date()
    if (entryName(entry.key) !== ".keep") {
      return [{ key: entry.key, name: relative, size: entry.size ?? 0, lastModified }]
    }
    // 取得対象そのものの marker は zip の root にあたるので落とす (名前が空の
    // entry を作ると zip の組み立てが失敗する)
    const folderName = relative.slice(0, -".keep".length)

    return folderName === "" ? [] : [{ key: entry.key, name: folderName, size: 0, lastModified }]
  })

type ZipStreamOptions = {
  s3: S3Client
  bucket: string
  entries: readonly ZipEntry[]
  // 転送済みバイト数の累計。UI の進捗表示に使う。
  onProgress?: (loadedBytes: number) => void
  signal?: AbortSignal
}

const countingStream = (
  source: ReadableStream<Uint8Array>,
  onBytes: (bytes: number) => void,
): ReadableStream<Uint8Array> =>
  source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      onBytes(chunk.byteLength)
      controller.enqueue(chunk)
    },
  }))

export const makeZipStream = ({
  s3,
  bucket,
  entries,
  onProgress,
  signal,
}: ZipStreamOptions): ReadableStream<Uint8Array> => {
  let loaded = 0
  // object は 1 つずつ取りに行く。まとめて開くと、大きな zip ほど多数の接続を
  // 開いたまま抱えることになる。
  const files = (async function* () {
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (isFolderEntry(entry)) {
        yield { name: entry.name, lastModified: entry.lastModified }
        continue
      }
      const res = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: entry.key }),
        signal === undefined ? {} : { abortSignal: signal },
      )
      const body = res.Body
      if (body === undefined) continue
      const source = body.transformToWebStream()
      yield {
        name: entry.name,
        lastModified: entry.lastModified,
        size: entry.size,
        input: onProgress === undefined ? source : countingStream(source, (bytes) => {
          loaded += bytes
          onProgress(loaded)
        }),
      }
    }
  })()

  return makeZip(files, { length: predictZipSize(entries) })
}

// 保存先は zip の大きさで決める。File System Access API を使うとブラウザが
// 「サイトにファイルの編集を許可するか」を確認するので、メモリに載る大きさの
// うちは通常のダウンロードにして、その確認を日常操作に持ち込まない。
export const saveZipStream = async (
  stream: ReadableStream<Uint8Array>,
  suggestedName: string,
  totalBytes: number,
): Promise<void> => {
  const picker = typeof window === "undefined" ? undefined : window.showSaveFilePicker
  if (picker !== undefined && totalBytes > MEMORY_ZIP_LIMIT_BYTES) {
    const handle = await picker({
      suggestedName,
      types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
    })
    const writable = await handle.createWritable()
    await stream.pipeTo(writable)

    return
  }

  const blob = await new Response(stream).blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = suggestedName
  anchor.click()
  // Revoking in the same task as the click can cancel a download the browser
  // has not started reading yet. Hand the blob back on the next task instead —
  // leaving it alive would pin the whole zip in memory.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// ユーザーが保存ダイアログを閉じた場合。失敗として扱わない。
export const isSaveCancelled = (err: unknown): boolean =>
  err instanceof DOMException && (err.name === "AbortError" || err.name === "NotAllowedError")
