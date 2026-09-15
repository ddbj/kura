import { afterEach, describe, expect, test, vi } from "vitest"

import type { PrefixEntry } from "~/lib/s3"
import {
  isZipTooLargeForMemory,
  MEMORY_ZIP_LIMIT_BYTES,
  predictZipSize,
  saveZipStream,
  zipEntriesForPrefix,
  type ZipEntry,
} from "~/lib/s3/zip"

const at = (iso: string): Date => new Date(iso)

const entry = (over: Partial<ZipEntry> = {}): ZipEntry => ({
  key: "screens/a.txt",
  name: "a.txt",
  size: 10,
  lastModified: at("2026-05-01T00:00:00Z"),
  ...over,
})

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete window.showSaveFilePicker
  // jsdom は URL.createObjectURL を持たない。テストのあいだだけ生やしたものを
  // 消しておかないと、同じ worker の他のテストへ漏れる。
  delete (URL as { createObjectURL?: unknown }).createObjectURL
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL
})

describe("zipEntriesForPrefix", () => {
  const listed = (over: Partial<PrefixEntry> & { key: string }): PrefixEntry => ({
    size: 5,
    lastModified: at("2026-02-02T03:04:00Z"),
    ...over,
  })

  test("zipEntriesForPrefix_nestedKeys_keepPathsRelativeToThePrefix", () => {
    const entries = zipEntriesForPrefix("screens/assembly/", [
      listed({ key: "screens/assembly/report.txt" }),
      listed({ key: "screens/assembly/sub/deep.bin", size: 7 }),
    ])

    expect(entries.map((e) => e.name)).toEqual(["report.txt", "sub/deep.bin"])
    expect(entries.map((e) => e.size)).toEqual([5, 7])
  })

  // .keep は folder marker。zip では中身のない folder entry にする
  test("zipEntriesForPrefix_keepMarker_becomesAFolderEntry", () => {
    const entries = zipEntriesForPrefix("screens/", [
      listed({ key: "screens/empty/.keep", size: 0 }),
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe("empty/")
    expect(entries[0]?.size).toBe(0)
  })

  // 取得対象そのものの marker は zip の root にあたる。名前が空の entry を作ると
  // zip の組み立てごと失敗するので、必ず落とす。
  test("zipEntriesForPrefix_markerOfTheRequestedFolder_isSkipped", () => {
    expect(zipEntriesForPrefix("screens/assembly/", [
      listed({ key: "screens/assembly/.keep", size: 0 }),
    ])).toEqual([])
  })

  test("zipEntriesForPrefix_missingMetadata_fallsBackToZeroAndNow", () => {
    const before = Date.now()
    const entries = zipEntriesForPrefix("screens/", [
      { key: "screens/odd.bin", size: undefined, lastModified: undefined },
    ])

    expect(entries[0]?.size).toBe(0)
    expect(entries[0]?.lastModified.getTime()).toBeGreaterThanOrEqual(before)
  })

  test("zipEntriesForPrefix_emptyListing_isEmpty", () => {
    expect(zipEntriesForPrefix("screens/", [])).toEqual([])
  })
})

describe("predictZipSize", () => {
  test("predictZipSize_growsWithContentAndEntryCount", () => {
    const one = predictZipSize([entry()])
    const bigger = predictZipSize([entry({ size: 1000 })])
    const two = predictZipSize([entry(), entry({ key: "screens/b.txt", name: "b.txt" })])

    expect(bigger).toBeGreaterThan(one)
    expect(two).toBeGreaterThan(one)
  })

  test("predictZipSize_folderEntry_countsOnlyItsHeaders", () => {
    const size = predictZipSize([entry({ name: "empty/", size: 0 })])

    expect(size).toBeGreaterThan(0)
    expect(size).toBeLessThan(200)
  })

  test("predictZipSize_noEntries_isTheEmptyArchiveSize", () => {
    expect(predictZipSize([])).toBeGreaterThanOrEqual(0)
  })
})

// ディスクへ直接書けるかどうかで、受け付けてよい大きさが変わる
describe("isZipTooLargeForMemory", () => {
  const huge = [entry({ size: MEMORY_ZIP_LIMIT_BYTES + 1 })]

  test("isZipTooLargeForMemory_withoutFilePicker_rejectsOverTheLimit", () => {
    expect(isZipTooLargeForMemory(huge)).toBe(true)
    expect(isZipTooLargeForMemory([entry({ size: 1024 })])).toBe(false)
  })

  test("isZipTooLargeForMemory_withFilePicker_allowsAnySize", () => {
    window.showSaveFilePicker = vi.fn()

    expect(isZipTooLargeForMemory(huge)).toBe(false)
  })
})

describe("saveZipStream", () => {
  // Blob ダウンロードは次の task で object URL を revoke する。次のテストが
  // URL のモックを差し替える前に、その task を流しておく。
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  const spyOnBlobDownload = (): string[] => {
    const downloads: string[] = []
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:zip"), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })

    return downloads
  }

  const stubPicker = (written: string[]) => {
    const createWritable = vi.fn(async () => new WritableStream<Uint8Array>({
      write(chunk) {
        written.push(new TextDecoder().decode(chunk))
      },
    }))
    const picker = vi.fn(async () => ({ createWritable } as unknown as FileSystemFileHandle))
    window.showSaveFilePicker = picker

    return picker
  }

  // メモリに載る大きさなら、File System Access API があっても使わない。
  // 使うとブラウザが「サイトにファイルの編集を許可するか」を確認してしまう。
  test("saveZipStream_smallZip_usesAPlainDownloadEvenWithTheFilePicker", async () => {
    const written: string[] = []
    const picker = stubPicker(written)
    const downloads = spyOnBlobDownload()

    await saveZipStream(streamOf("zip-bytes"), "bundle.zip", 1024)

    expect(picker).not.toHaveBeenCalled()
    expect(downloads).toEqual(["bundle.zip"])
  })

  test("saveZipStream_largeZip_streamsIntoTheChosenFile", async () => {
    const written: string[] = []
    const picker = stubPicker(written)

    await saveZipStream(streamOf("zip-bytes"), "bundle.zip", MEMORY_ZIP_LIMIT_BYTES + 1)

    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: "bundle.zip" }))
    expect(written.join("")).toBe("zip-bytes")
  })

  // 境界: ちょうど上限までは通常のダウンロード
  test("saveZipStream_exactlyAtTheLimit_staysOnThePlainDownload", async () => {
    const picker = stubPicker([])
    const downloads = spyOnBlobDownload()

    await saveZipStream(streamOf("zip-bytes"), "bundle.zip", MEMORY_ZIP_LIMIT_BYTES)

    expect(picker).not.toHaveBeenCalled()
    expect(downloads).toEqual(["bundle.zip"])
  })

  test("saveZipStream_withoutFilePicker_fallsBackToABlobDownload", async () => {
    const downloads = spyOnBlobDownload()

    await saveZipStream(streamOf("zip-bytes"), "bundle.zip", 1024)

    expect(downloads).toEqual(["bundle.zip"])
    // click と同じ task で revoke するとダウンロードが始まる前に blob が
    // 消えうるので、次の task に回している。放置するとメモリに残り続ける。
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:zip")
  })
})
