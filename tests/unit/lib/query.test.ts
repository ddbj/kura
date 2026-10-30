import { QueryObserver } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"

import { createQueryClient, refreshAfterWrite } from "~/lib/query"

// A listing whose responses the test releases one by one, so a write can land
// while the first fetch is still in flight.
const slowListing = () => {
  let stored = ["a.txt"]
  const pending: (() => void)[] = []
  const queryFn = () => {
    const snapshot = [...stored]
    return new Promise<string[]>((resolve) => { pending.push(() => resolve(snapshot)) })
  }
  return {
    queryFn,
    write: (name: string) => { stored = [...stored, name] },
    // Answers every fetch, including ones started while answering, until
    // `until` settles.
    answerUntil: async (until: Promise<unknown>) => {
      let settled = false
      void until.then(() => { settled = true })
      while (!settled) {
        pending.shift()?.()
        await new Promise((r) => setTimeout(r, 0))
      }
    },
  }
}

describe("refreshAfterWrite", () => {
  it("firstFetchInFlight_writeLands_listShowsTheWrite", async () => {
    const queryClient = createQueryClient()
    const listing = slowListing()
    const observer = new QueryObserver(queryClient, { queryKey: ["objects", "alice", ""], queryFn: listing.queryFn })
    const unsubscribe = observer.subscribe(() => undefined)

    listing.write("uploaded.txt")
    await listing.answerUntil(refreshAfterWrite(queryClient, ["objects", "alice"]))

    expect(observer.getCurrentResult().data).toEqual(["a.txt", "uploaded.txt"])
    unsubscribe()
  })

  it("loadedListing_writeLands_listShowsTheWrite", async () => {
    const queryClient = createQueryClient()
    const listing = slowListing()
    const observer = new QueryObserver(queryClient, { queryKey: ["objects", "alice", ""], queryFn: listing.queryFn })
    const unsubscribe = observer.subscribe(() => undefined)
    await listing.answerUntil(observer.refetch())
    expect(observer.getCurrentResult().data).toEqual(["a.txt"])

    listing.write("uploaded.txt")
    await listing.answerUntil(refreshAfterWrite(queryClient, ["objects", "alice"]))

    expect(observer.getCurrentResult().data).toEqual(["a.txt", "uploaded.txt"])
    unsubscribe()
  })

  it("otherBucket_isNotRefetched", async () => {
    const queryClient = createQueryClient()
    const listing = slowListing()
    const observer = new QueryObserver(queryClient, { queryKey: ["objects", "bob", ""], queryFn: listing.queryFn })
    const unsubscribe = observer.subscribe(() => undefined)
    await listing.answerUntil(observer.refetch())

    listing.write("uploaded.txt")
    await listing.answerUntil(refreshAfterWrite(queryClient, ["objects", "alice"]))

    expect(observer.getCurrentResult().data).toEqual(["a.txt"])
    unsubscribe()
  })
})
