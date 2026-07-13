import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { createS3Client } from "./client"
import { assumeRoleWithToken } from "./sts"

export type PresignMethod = "GET" | "PUT"

export type PresignedShare = {
  url: string
  // When the URL actually stops working: the STS session expiry caps
  // X-Amz-Expires (docs/architecture.md presign).
  expiresAt: Date
}

// Mint a fresh STS session per issued URL so the requested lifetime is capped
// only by the session length (~12h with the kura client token lifespan).
export const presignShareUrl = async ({ endpoint, token, bucket, key, method, expiresInSeconds }: {
  endpoint: string
  token: string
  bucket: string
  key: string
  method: PresignMethod
  expiresInSeconds: number
}): Promise<PresignedShare> => {
  const credentials = await assumeRoleWithToken(endpoint, token)
  const client = createS3Client(endpoint, () => Promise.resolve(credentials))
  const command = method === "GET"
    ? new GetObjectCommand({ Bucket: bucket, Key: key })
    : new PutObjectCommand({ Bucket: bucket, Key: key })
  const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds })
  const requested = new Date(Date.now() + expiresInSeconds * 1000)

  return { url, expiresAt: requested < credentials.expiration ? requested : credentials.expiration }
}
