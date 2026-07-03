import { S3Client } from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"

import { cleanupBucketUploads } from "../../../scripts/lib/multipart.ts"

const OLD = new Date("2020-01-01T00:00:00Z")
const RECENT = new Date("2020-01-10T00:00:00Z")
const NOW = new Date("2020-01-20T00:00:00Z") // 19 days after OLD, 10 after RECENT; maxAgeDays=7

// paginateListParts/ListMultipartUploads check `client instanceof S3Client`,
// so the stub must actually be one; only .send is replaced.
const stubClient = (listPartsPages: () => { LastModified: Date }[][]): S3Client => {
  const pages = listPartsPages()
  let call = 0
  const send = vi.fn(async (command: { constructor: { name: string } }) => {
    switch (command.constructor.name) {
      case "ListMultipartUploadsCommand":
        return { Uploads: [{ Key: "big.bin", UploadId: "up-1" }], IsTruncated: false }
      case "ListPartsCommand": {
        const parts = pages[Math.min(call, pages.length - 1)]!
        call += 1

        return { Parts: parts.map((p, i) => ({ PartNumber: i + 1, LastModified: p.LastModified })), IsTruncated: false }
      }
      case "AbortMultipartUploadCommand":
        return {}
      default:
        throw new Error(`unexpected command ${command.constructor.name}`)
    }
  })

  return Object.assign(Object.create(S3Client.prototype), { send })
}

describe("cleanupBucketUploads recheck", () => {
  it("skips the abort when a new part appears between the snapshot and the recheck", async () => {
    const s3 = stubClient(() => [
      [{ LastModified: OLD }],
      [{ LastModified: OLD }, { LastModified: RECENT }],
    ])
    await expect(cleanupBucketUploads(s3, "alice", 7, NOW)).resolves.toBe(0)
  })

  it("aborts once the recheck confirms no new activity", async () => {
    const s3 = stubClient(() => [
      [{ LastModified: OLD }],
      [{ LastModified: OLD }],
    ])
    await expect(cleanupBucketUploads(s3, "alice", 7, NOW)).resolves.toBe(1)
  })
})
