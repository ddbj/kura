import { beforeEach, describe, expect, test } from "vitest"

import {
  addSessionPresigned,
  dropSessionPresigned,
  dropSessionPresignedUnder,
  listSessionPresigned,
  type SessionPresigned,
  sessionPresignedVersion,
  subscribeSessionPresigned,
} from "~/lib/session-presigned"

const STORAGE_KEY = "kura.presigned"
const HOUR = 3_600_000

const entry = (over: Partial<SessionPresigned> = {}): SessionPresigned => ({
  bucket: "kura-tester",
  key: "a.txt",
  url: "https://s3.test/a.txt?X-Amz-Signature=deadbeef",
  method: "GET",
  expiresAt: Date.now() + HOUR,
  ...over,
})

beforeEach(() => {
  window.sessionStorage.clear()
})

describe("session presigned log", () => {
  test("sessionPresigned_sameKeyIssuedTwice_keepsOnlyTheLatest", () => {
    addSessionPresigned(entry({ url: "https://s3.test/a.txt?first" }))
    addSessionPresigned(entry({ url: "https://s3.test/a.txt?second" }))

    const stored = listSessionPresigned("kura-tester")
    expect(stored).toHaveLength(1)
    expect(stored[0]?.url).toBe("https://s3.test/a.txt?second")
  })

  test("sessionPresigned_otherBucket_isNotListed", () => {
    addSessionPresigned(entry({ bucket: "someone-else" }))

    expect(listSessionPresigned("kura-tester")).toEqual([])
  })

  test("sessionPresigned_expiredEntry_isNotListed", () => {
    addSessionPresigned(entry({ key: "fresh.txt" }))
    addSessionPresigned(entry({ key: "stale.txt", expiresAt: Date.now() - 1 }))

    expect(listSessionPresigned("kura-tester").map((e) => e.key)).toEqual(["fresh.txt"])
  })

  // 境界: expiresAt === now は「もう切れている」側に倒す
  test("sessionPresigned_expiringExactlyNow_isNotListed", () => {
    const now = Date.now()
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([entry({ expiresAt: now })]))

    expect(listSessionPresigned("kura-tester")).toEqual([])
  })

  test("sessionPresigned_droppedKeys_disappearAndOthersStay", () => {
    addSessionPresigned(entry({ key: "a.txt" }))
    addSessionPresigned(entry({ key: "b.txt" }))
    addSessionPresigned(entry({ key: "c.txt" }))

    dropSessionPresigned("kura-tester", ["a.txt", "c.txt"])

    expect(listSessionPresigned("kura-tester").map((e) => e.key)).toEqual(["b.txt"])
  })

  test("sessionPresigned_dropWithEmptyKeys_keepsEverything", () => {
    addSessionPresigned(entry({ key: "a.txt" }))

    dropSessionPresigned("kura-tester", [])

    expect(listSessionPresigned("kura-tester").map((e) => e.key)).toEqual(["a.txt"])
  })

  test("sessionPresigned_dropInOtherBucket_doesNotTouchOurs", () => {
    addSessionPresigned(entry({ key: "a.txt" }))

    dropSessionPresigned("someone-else", ["a.txt"])

    expect(listSessionPresigned("kura-tester").map((e) => e.key)).toEqual(["a.txt"])
  })

  test("sessionPresigned_dropUnderPrefix_removesOnlyThatSubtree", () => {
    addSessionPresigned(entry({ key: "docs/a.txt" }))
    addSessionPresigned(entry({ key: "docs/deep/b.txt" }))
    addSessionPresigned(entry({ key: "docs-2/c.txt" }))
    addSessionPresigned(entry({ key: "other.txt" }))

    dropSessionPresignedUnder("kura-tester", "docs/")

    expect(listSessionPresigned("kura-tester").map((e) => e.key).sort())
      .toEqual(["docs-2/c.txt", "other.txt"])
  })

  test("sessionPresigned_corruptStorage_readsAsEmpty", () => {
    window.sessionStorage.setItem(STORAGE_KEY, "{not json")

    expect(listSessionPresigned("kura-tester")).toEqual([])
  })

  test("sessionPresigned_entriesMissingFields_areIgnored", () => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([
      { bucket: "kura-tester", key: "no-url.txt", method: "GET", expiresAt: Date.now() + HOUR },
      entry({ key: "ok.txt" }),
    ]))

    expect(listSessionPresigned("kura-tester").map((e) => e.key)).toEqual(["ok.txt"])
  })

  // lens の件数と行の表示は同じ記録を見ている。書き換えの通知を取りこぼすと
  // 「件数だけ残る」状態になるので、購読は add / drop の両方で発火させる。
  test("sessionPresigned_everyWrite_bumpsVersionAndNotifies", () => {
    const seen: number[] = []
    const unsubscribe = subscribeSessionPresigned(() => seen.push(sessionPresignedVersion()))

    addSessionPresigned(entry({ key: "a.txt" }))
    dropSessionPresigned("kura-tester", ["a.txt"])
    dropSessionPresignedUnder("kura-tester", "docs/")

    expect(seen).toHaveLength(3)
    expect(seen[0]).toBeLessThan(seen[1] as number)
    expect(seen[1]).toBeLessThan(seen[2] as number)

    unsubscribe()
    addSessionPresigned(entry({ key: "b.txt" }))
    expect(seen).toHaveLength(3)
  })

  test("sessionPresigned_readOnlyCalls_doNotBumpVersion", () => {
    addSessionPresigned(entry({ key: "a.txt" }))
    const before = sessionPresignedVersion()

    listSessionPresigned("kura-tester")

    expect(sessionPresignedVersion()).toBe(before)
  })
})
