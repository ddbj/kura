import { keyToUrlPath } from "./keys"

// Permanent URL of a published object (docs/architecture.md 公開方式): the
// path is the bucket (= username) followed by the percent-encoded key.
export const publicUrl = (publicBase: string, bucket: string, key: string): string =>
  `${publicBase.replace(/\/+$/, "")}/${bucket}/${keyToUrlPath(key)}`
