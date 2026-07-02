// Same acceptance set as SeaweedFS's VerifyS3BucketName, restricted to ASCII:
// SeaweedFS itself admits any unicode lowercase/digit, but IAM policy variables
// and the public-delivery routing are ASCII-based (docs/architecture.md 配置).
const VALID_SHAPE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/

const isIpV4 = (name: string): boolean => {
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name)
  if (octets === null) return false
  return octets.slice(1).every((octet) => Number(octet) <= 255 && (octet === "0" || !octet.startsWith("0")))
}

export const isUsableBucketName = (name: string): boolean =>
  VALID_SHAPE.test(name) &&
  name !== "filemeta" &&
  !name.includes("..") &&
  !name.startsWith("xn--") &&
  !name.endsWith("-s3alias") &&
  !isIpV4(name)
