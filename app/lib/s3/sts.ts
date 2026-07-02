import { AssumeRoleWithWebIdentityCommand, STSClient } from "@aws-sdk/client-sts"

// Mirrors the role ARN wired into iam.json (seaweedfs/entrypoint.sh).
export const USER_ROLE_ARN = "arn:aws:iam::role/KuraUserRole"

export type StsCredentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  expiration: Date
}

// SeaweedFS serves STS on the same endpoint as S3. The session is capped by
// min(token exp remaining, DurationSeconds) — see docs/architecture.md presign.
export const assumeRoleWithToken = async (endpoint: string, token: string): Promise<StsCredentials> => {
  const sts = new STSClient({ endpoint, region: "us-east-1" })
  const res = await sts.send(new AssumeRoleWithWebIdentityCommand({
    RoleArn: USER_ROLE_ARN,
    RoleSessionName: `kura-spa-${crypto.randomUUID().slice(0, 8)}`,
    WebIdentityToken: token,
    DurationSeconds: 3600,
  }))
  const c = res.Credentials
  if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) {
    throw new Error("STS returned incomplete credentials")
  }
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
    expiration: c.Expiration,
  }
}
