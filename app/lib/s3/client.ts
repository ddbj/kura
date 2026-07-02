import { S3Client } from "@aws-sdk/client-s3"

import type { StsCredentials } from "./sts"

// SeaweedFS compatibility settings mirror tests/integration/_helpers.ts:
// path-style addressing and no flexible checksums.
export const createS3Client = (endpoint: string, credentials: () => Promise<StsCredentials>): S3Client =>
  new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })
