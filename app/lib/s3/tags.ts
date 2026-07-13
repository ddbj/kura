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

// A read-modify-write on the object's tag set: preserve every non-public tag
// that already lives on the object (a CLI user's or another tool's tags) and
// only alter the kura-public marker. Overwriting the whole tag set would
// silently wipe unrelated tags.
const readTags = async (s3: S3Client, bucket: string, key: string): Promise<Tag[]> => {
  const res = await s3.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }))

  return res.TagSet ?? []
}

export const publishObject = async (s3: S3Client, bucket: string, key: string): Promise<void> => {
  const existing = await readTags(s3, bucket, key)
  const nextTags: Tag[] = [
    ...existing.filter((tag) => tag.Key !== PUBLIC_TAG_KEY),
    { Key: PUBLIC_TAG_KEY, Value: PUBLIC_TAG_VALUE },
  ]
  await s3.send(new PutObjectTaggingCommand({
    Bucket: bucket,
    Key: key,
    Tagging: { TagSet: nextTags },
  }))
}

export const unpublishObject = async (s3: S3Client, bucket: string, key: string): Promise<void> => {
  const existing = await readTags(s3, bucket, key)
  const remaining = existing.filter((tag) => tag.Key !== PUBLIC_TAG_KEY)
  if (remaining.length === 0) {
    // S3 rejects PutObjectTagging with an empty TagSet; DeleteObjectTagging
    // clears the whole set atomically instead.
    await s3.send(new DeleteObjectTaggingCommand({ Bucket: bucket, Key: key }))

    return
  }
  await s3.send(new PutObjectTaggingCommand({
    Bucket: bucket,
    Key: key,
    Tagging: { TagSet: remaining },
  }))
}
