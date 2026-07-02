const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

type StsCredentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  expiration: string
}

export const stsAssumeRoleXml = ({ accessKeyId, secretAccessKey, sessionToken, expiration }: StsCredentials): string => `<?xml version="1.0" encoding="UTF-8"?>
<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <AssumeRoleWithWebIdentityResult>
    <Credentials>
      <AccessKeyId>${escapeXml(accessKeyId)}</AccessKeyId>
      <SecretAccessKey>${escapeXml(secretAccessKey)}</SecretAccessKey>
      <SessionToken>${escapeXml(sessionToken)}</SessionToken>
      <Expiration>${expiration}</Expiration>
    </Credentials>
  </AssumeRoleWithWebIdentityResult>
</AssumeRoleWithWebIdentityResponse>`

type ListedObject = {
  key: string
  size: number
  lastModified: string
}

type ListBucketInput = {
  bucket: string
  prefix: string
  objects: ListedObject[]
  commonPrefixes: string[]
  nextContinuationToken?: string
}

export const listObjectsV2Xml = ({ bucket, prefix, objects, commonPrefixes, nextContinuationToken }: ListBucketInput): string => `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${escapeXml(bucket)}</Name>
  <Prefix>${escapeXml(prefix)}</Prefix>
  <Delimiter>/</Delimiter>
  <KeyCount>${objects.length + commonPrefixes.length}</KeyCount>
  <IsTruncated>${nextContinuationToken === undefined ? "false" : "true"}</IsTruncated>
  ${nextContinuationToken === undefined ? "" : `<NextContinuationToken>${escapeXml(nextContinuationToken)}</NextContinuationToken>`}
  ${objects.map((o) => `<Contents><Key>${escapeXml(o.key)}</Key><Size>${o.size}</Size><LastModified>${o.lastModified}</LastModified><ETag>&quot;etag&quot;</ETag><StorageClass>STANDARD</StorageClass></Contents>`).join("\n  ")}
  ${commonPrefixes.map((p) => `<CommonPrefixes><Prefix>${escapeXml(p)}</Prefix></CommonPrefixes>`).join("\n  ")}
</ListBucketResult>`

export const s3ErrorXml = (code: string, message: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message></Error>`
