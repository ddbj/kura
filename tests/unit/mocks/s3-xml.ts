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

export const getObjectTaggingXml = (tags: { key: string; value: string }[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<Tagging xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <TagSet>
    ${tags.map((t) => `<Tag><Key>${escapeXml(t.key)}</Key><Value>${escapeXml(t.value)}</Value></Tag>`).join("\n    ")}
  </TagSet>
</Tagging>`

export const s3ErrorXml = (code: string, message: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message></Error>`

type ListedUpload = {
  key: string
  uploadId: string
}

// SeaweedFS 形状: Upload に Initiated が無い（実測固定化済み。s3-flows）
export const listMultipartUploadsXml = ({ bucket, uploads, nextKeyMarker, nextUploadIdMarker }: {
  bucket: string
  uploads: ListedUpload[]
  nextKeyMarker?: string
  nextUploadIdMarker?: string
}): string => `<?xml version="1.0" encoding="UTF-8"?>
<ListMultipartUploadsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>${escapeXml(bucket)}</Bucket>
  <IsTruncated>${nextKeyMarker === undefined ? "false" : "true"}</IsTruncated>
  ${nextKeyMarker === undefined ? "" : `<NextKeyMarker>${escapeXml(nextKeyMarker)}</NextKeyMarker>`}
  ${nextUploadIdMarker === undefined ? "" : `<NextUploadIdMarker>${escapeXml(nextUploadIdMarker)}</NextUploadIdMarker>`}
  ${uploads.map((u) => `<Upload><Key>${escapeXml(u.key)}</Key><UploadId>${escapeXml(u.uploadId)}</UploadId></Upload>`).join("\n  ")}
</ListMultipartUploadsResult>`

type ListedPart = {
  partNumber: number
  size: number
  etag: string
  lastModified?: string
}

export const listPartsXml = ({ bucket, key, uploadId, parts, nextPartNumberMarker }: {
  bucket: string
  key: string
  uploadId: string
  parts: ListedPart[]
  nextPartNumberMarker?: number
}): string => `<?xml version="1.0" encoding="UTF-8"?>
<ListPartsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>${escapeXml(bucket)}</Bucket>
  <Key>${escapeXml(key)}</Key>
  <UploadId>${escapeXml(uploadId)}</UploadId>
  <IsTruncated>${nextPartNumberMarker === undefined ? "false" : "true"}</IsTruncated>
  ${nextPartNumberMarker === undefined ? "" : `<NextPartNumberMarker>${nextPartNumberMarker}</NextPartNumberMarker>`}
  ${parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><Size>${p.size}</Size><ETag>&quot;${escapeXml(p.etag)}&quot;</ETag>${p.lastModified === undefined ? "" : `<LastModified>${p.lastModified}</LastModified>`}</Part>`).join("\n  ")}
</ListPartsResult>`

export const initiateMultipartUploadXml = ({ bucket, key, uploadId }: {
  bucket: string
  key: string
  uploadId: string
}): string => `<?xml version="1.0" encoding="UTF-8"?>
<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>${escapeXml(bucket)}</Bucket>
  <Key>${escapeXml(key)}</Key>
  <UploadId>${escapeXml(uploadId)}</UploadId>
</InitiateMultipartUploadResult>`

export const completeMultipartUploadXml = ({ bucket, key, etag }: {
  bucket: string
  key: string
  etag: string
}): string => `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>${escapeXml(bucket)}</Bucket>
  <Key>${escapeXml(key)}</Key>
  <ETag>&quot;${escapeXml(etag)}&quot;</ETag>
</CompleteMultipartUploadResult>`
