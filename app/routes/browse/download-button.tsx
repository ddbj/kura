import { useMutation } from "@tanstack/react-query"

import { useT } from "~/lib/i18n"
import { presignDownloadUrl, useS3 } from "~/lib/s3"
import { Button } from "~/ui"

// Mint a short-lived presigned URL and let the browser fetch it directly:
// the bytes never pass through the SPA (docs/architecture.md 原則).
export const DownloadButton = ({ bucket, fileKey }: { bucket: string; fileKey: string }) => {
  const t = useT()
  const s3 = useS3()
  const download = useMutation({
    mutationFn: async () => {
      const url = await presignDownloadUrl(s3, bucket, fileKey)
      const anchor = document.createElement("a")
      anchor.href = url
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    },
  })
  return (
    <Button kind="ghost" size="sm" onClick={() => download.mutate()} disabled={download.isPending}>
      {t("browse.download")}
    </Button>
  )
}
