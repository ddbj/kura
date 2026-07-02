import type { S3Client } from "@aws-sdk/client-s3"

import { createS3Client } from "~/lib/s3/client"

export const TEST_S3_ENDPOINT = "http://localhost:28333"

// A client with static in-memory credentials; the HTTP boundary is msw.
export const testS3 = (): S3Client =>
  createS3Client(TEST_S3_ENDPOINT, () => Promise.resolve({
    accessKeyId: "AKIATEST",
    secretAccessKey: "secret",
    sessionToken: "session-token",
    expiration: new Date(Date.now() + 3600_000),
  }))
