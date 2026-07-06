import { useMutation } from "@tanstack/react-query"

import { useT } from "~/lib/i18n"
import { presignDownloadUrl, useS3 } from "~/lib/s3"
import { Button, Callout, DownloadIcon } from "~/ui"

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
    <span className="inline-flex flex-col items-end gap-1">
      <Button kind="secondary" size="sm" onClick={() => download.mutate()} disabled={download.isPending}>
        <DownloadIcon size={14} />
        {t("browse.download")}
      </Button>
      {download.isError ? <Callout tone="warn" role="alert">{t("browse.downloadFailed")}</Callout> : null}
    </span>
  )
}
