const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

type StsCredentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  expiration: string
}

export const listBucketsXml = (buckets: readonly { name: string }[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner><ID>test</ID><DisplayName>test</DisplayName></Owner>
  <Buckets>
    ${buckets.map((b) => `<Bucket><Name>${escapeXml(b.name)}</Name><CreationDate>2026-07-01T00:00:00.000Z</CreationDate></Bucket>`).join("\n    ")}
  </Buckets>
</ListAllMyBucketsResult>`

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

type ListedObjectMaybe = {
  key: string
  size?: number
  lastModified: string
}

type ListBucketInput = {
  bucket: string
  prefix: string
  objects: ListedObjectMaybe[]
  commonPrefixes: string[]
  nextContinuationToken?: string
  // Force IsTruncated=true even without a NextContinuationToken (reproduces
  // the SeaweedFS-observed shape that would otherwise loop forever).
  truncatedNoToken?: boolean
}

export const listObjectsV2Xml = ({ bucket, prefix, objects, commonPrefixes, nextContinuationToken, truncatedNoToken }: ListBucketInput): string => {
  const isTruncated = truncatedNoToken === true || nextContinuationToken !== undefined

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${escapeXml(bucket)}</Name>
  <Prefix>${escapeXml(prefix)}</Prefix>
  <Delimiter>/</Delimiter>
  <KeyCount>${objects.length + commonPrefixes.length}</KeyCount>
  <IsTruncated>${isTruncated ? "true" : "false"}</IsTruncated>
  ${nextContinuationToken === undefined ? "" : `<NextContinuationToken>${escapeXml(nextContinuationToken)}</NextContinuationToken>`}
  ${objects.map((o) => `<Contents><Key>${escapeXml(o.key)}</Key>${o.size === undefined ? "" : `<Size>${o.size}</Size>`}<LastModified>${o.lastModified}</LastModified><ETag>&quot;etag&quot;</ETag><StorageClass>STANDARD</StorageClass></Contents>`).join("\n  ")}
  ${commonPrefixes.map((p) => `<CommonPrefixes><Prefix>${escapeXml(p)}</Prefix></CommonPrefixes>`).join("\n  ")}
</ListBucketResult>`
}

export const getObjectTaggingXml = (tags: { key: string; value: string }[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<Tagging xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <TagSet>
    ${tags.map((t) => `<Tag><Key>${escapeXml(t.key)}</Key><Value>${escapeXml(t.value)}</Value></Tag>`).join("\n    ")}
  </TagSet>
</Tagging>`

export const s3ErrorXml = (code: string, message: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message></Error>`

export const copyObjectXml = (etag: string, lastModified: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<CopyObjectResult>
  <ETag>&quot;${escapeXml(etag)}&quot;</ETag>
  <LastModified>${lastModified}</LastModified>
</CopyObjectResult>`

type DeleteResultInput = {
  deleted: string[]
  errors?: { key: string; code: string; message: string }[]
}

export const deleteObjectsXml = ({ deleted, errors }: DeleteResultInput): string => `<?xml version="1.0" encoding="UTF-8"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  ${deleted.map((k) => `<Deleted><Key>${escapeXml(k)}</Key></Deleted>`).join("\n  ")}
  ${(errors ?? []).map((e) => `<Error><Key>${escapeXml(e.key)}</Key><Code>${escapeXml(e.code)}</Code><Message>${escapeXml(e.message)}</Message></Error>`).join("\n  ")}
</DeleteResult>`

type ListedUpload = {
  key: string
  uploadId: string
}

// ListMultipartUploads wire format: SeaweedFS omits the <Initiated> element
// per Upload (see docs/architecture.md 配置 / app/lib/s3/multipart.ts:
// resume recency comes from part LastModified). Kept out of this template
// so tests never accidentally rely on a timestamp the server never sends.
export const listMultipartUploadsXml = ({ bucket, uploads, nextKeyMarker, nextUploadIdMarker, truncatedNoMarker }: {
  bucket: string
  uploads: ListedUpload[]
  nextKeyMarker?: string
  nextUploadIdMarker?: string
  // Force IsTruncated=true without either Next* marker (the pagination
  // no-progress shape the paginator must refuse to re-enter).
  truncatedNoMarker?: boolean
}): string => {
  const isTruncated = truncatedNoMarker === true || nextKeyMarker !== undefined || nextUploadIdMarker !== undefined

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListMultipartUploadsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>${escapeXml(bucket)}</Bucket>
  <IsTruncated>${isTruncated ? "true" : "false"}</IsTruncated>
  ${nextKeyMarker === undefined ? "" : `<NextKeyMarker>${escapeXml(nextKeyMarker)}</NextKeyMarker>`}
  ${nextUploadIdMarker === undefined ? "" : `<NextUploadIdMarker>${escapeXml(nextUploadIdMarker)}</NextUploadIdMarker>`}
  ${uploads.map((u) => `<Upload><Key>${escapeXml(u.key)}</Key><UploadId>${escapeXml(u.uploadId)}</UploadId></Upload>`).join("\n  ")}
</ListMultipartUploadsResult>`
}

type ListedPart = {
  partNumber: number
  size: number
  etag: string
  lastModified?: string
}

export const listPartsXml = ({ bucket, key, uploadId, parts, nextPartNumberMarker, truncatedNoMarker }: {
  bucket: string
  key: string
  uploadId: string
  parts: ListedPart[]
  nextPartNumberMarker?: number
  // Force IsTruncated=true without NextPartNumberMarker (pagination
  // no-progress shape).
  truncatedNoMarker?: boolean
}): string => {
  const isTruncated = truncatedNoMarker === true || nextPartNumberMarker !== undefined

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListPartsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>${escapeXml(bucket)}</Bucket>
  <Key>${escapeXml(key)}</Key>
  <UploadId>${escapeXml(uploadId)}</UploadId>
  <IsTruncated>${isTruncated ? "true" : "false"}</IsTruncated>
  ${nextPartNumberMarker === undefined ? "" : `<NextPartNumberMarker>${nextPartNumberMarker}</NextPartNumberMarker>`}
  ${parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><Size>${p.size}</Size><ETag>&quot;${escapeXml(p.etag)}&quot;</ETag>${p.lastModified === undefined ? "" : `<LastModified>${p.lastModified}</LastModified>`}</Part>`).join("\n  ")}
</ListPartsResult>`
}

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
