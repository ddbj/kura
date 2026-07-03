// SeaweedFS's S3 gateway needs path-style addressing and does not support
// AWS's newer flexible request/response checksums. Shared by app/lib/s3/client.ts
// and tests/integration/_helpers.ts; scripts/lib/s3.ts keeps its own copy of
// these same values because the ops container only mounts scripts/ and
// node_modules/, not app/ (compose.yml).
export const SEAWEEDFS_S3_CLIENT_OPTIONS = {
  region: "us-east-1",
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
} as const
