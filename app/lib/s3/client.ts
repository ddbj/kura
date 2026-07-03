import { S3Client } from "@aws-sdk/client-s3"

import { SEAWEEDFS_S3_CLIENT_OPTIONS } from "./seaweedfs-compat"
import type { StsCredentials } from "./sts"

export const createS3Client = (endpoint: string, credentials: () => Promise<StsCredentials>): S3Client =>
  new S3Client({
    endpoint,
    credentials,
    ...SEAWEEDFS_S3_CLIENT_OPTIONS,
  })
