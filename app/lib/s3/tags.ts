import {
  DeleteObjectTaggingCommand,
  GetObjectTaggingCommand,
  PutObjectTaggingCommand,
  type S3Client,
  type Tag,
} from "@aws-sdk/client-s3"

export const PUBLIC_TAG_KEY = "kura-public"
export const PUBLIC_TAG_VALUE = "true"

// nginx compares the tag value against "true" verbatim (nginx/kura.conf), so
// any other value means private.
export const isPublicTagging = (tags: Tag[] | undefined): boolean =>
  (tags ?? []).some((tag) => tag.Key === PUBLIC_TAG_KEY && tag.Value === PUBLIC_TAG_VALUE)

export const getObjectIsPublic = async (s3: S3Client, bucket: string, key: string): Promise<boolean> => {
  const res = await s3.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }))

  return isPublicTagging(res.TagSet)
}

export const publishObject = async (s3: S3Client, bucket: string, key: string): Promise<void> => {
  await s3.send(new PutObjectTaggingCommand({
    Bucket: bucket,
    Key: key,
    Tagging: { TagSet: [{ Key: PUBLIC_TAG_KEY, Value: PUBLIC_TAG_VALUE }] },
  }))
}

export const unpublishObject = async (s3: S3Client, bucket: string, key: string): Promise<void> => {
  await s3.send(new DeleteObjectTaggingCommand({ Bucket: bucket, Key: key }))
}
