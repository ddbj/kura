import { assumeRoleWithToken, type StsCredentials } from "./sts"

export type GetToken = () => Promise<string>

// The AWS SDK re-invokes a credentials provider before the returned expiration
// (with a safety window), so long-running transfers keep working as long as
// getToken can produce a fresh access token (silent renew).
export const createStsCredentialsProvider = (getToken: GetToken, endpoint: string) =>
  async (): Promise<StsCredentials> => assumeRoleWithToken(endpoint, await getToken())
