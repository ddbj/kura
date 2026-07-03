import { ListBucketsCommand, S3Client } from "@aws-sdk/client-s3"

export const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`)
  }

  return value
}

// Root-credential client for ops tasks; user traffic never takes this path
// (docs/operations.md). SeaweedFS compatibility settings mirror
// app/lib/s3/seaweedfs-compat.ts, kept as its own copy rather than importing
// it: the ops container only mounts scripts/ and node_modules/, not app/
// (compose.yml), so this file cannot reach across to app/.
export const opsS3Client = (): S3Client =>
  new S3Client({
    endpoint: requireEnv("KURA_S3_ENDPOINT"),
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv("KURA_ROOT_ACCESS_KEY"),
      secretAccessKey: requireEnv("KURA_ROOT_SECRET_KEY"),
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })

export const listBucketNames = async (s3: S3Client): Promise<string[]> => {
  const res = await s3.send(new ListBucketsCommand({}))

  return (res.Buckets ?? []).flatMap((bucket) => bucket.Name === undefined ? [] : [bucket.Name])
}
