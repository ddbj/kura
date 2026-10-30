import { AssumeRoleWithWebIdentityCommand, STSClient } from "@aws-sdk/client-sts"

// Mirrors the role ARN wired into iam.json (seaweedfs/entrypoint.sh).
export const USER_ROLE_ARN = "arn:aws:iam::role/KuraUserRole"

export type StsCredentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  expiration: Date
}

// The range SeaweedFS's STS accepts for DurationSeconds; the upper end is
// sts.maxSessionLength.
const MIN_SESSION_SECONDS = 900
const MAX_SESSION_SECONDS = 43_200

// SeaweedFS serves STS on the same endpoint as S3. The session lasts
// durationSeconds, or sts.tokenDuration (1h) when omitted, regardless of how
// long the access token itself has left.
export const assumeRoleWithToken = async (
  endpoint: string,
  token: string,
  durationSeconds?: number,
): Promise<StsCredentials> => {
  if (durationSeconds !== undefined
    && !(Number.isInteger(durationSeconds) && durationSeconds >= MIN_SESSION_SECONDS && durationSeconds <= MAX_SESSION_SECONDS)) {
    throw new RangeError(`STS session length must be ${MIN_SESSION_SECONDS}..${MAX_SESSION_SECONDS} seconds: ${durationSeconds}`)
  }
  const sts = new STSClient({ endpoint, region: "us-east-1" })
  const res = await sts.send(new AssumeRoleWithWebIdentityCommand({
    RoleArn: USER_ROLE_ARN,
    RoleSessionName: `kura-spa-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    WebIdentityToken: token,
    ...(durationSeconds === undefined ? {} : { DurationSeconds: durationSeconds }),
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
