import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useConfig } from "~/lib/config"
import { useT } from "~/lib/i18n"
import {
  applyPublicState,
  beginPublicStateChange,
  entryName,
  publicUrl,
  publishObject,
  revertPublicStateOnFailure,
  unpublishObject,
  useS3,
} from "~/lib/s3"
import { Callout, CopyField, Toggle } from "~/ui"

// Always rendered next to the file it belongs to (no click-to-reveal): the
// switch itself performs the publish/unpublish mutation, and the resulting
// URL is shown inline the moment the file is public.
export const PublicControl = ({ bucket, fileKey, isPublic }: {
  bucket: string
  fileKey: string
  isPublic: boolean | undefined
}) => {
  const t = useT()
  const config = useConfig()
  const s3 = useS3()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: ({ key, makePublic }: { key: string; makePublic: boolean }) =>
      makePublic ? publishObject(s3, bucket, key) : unpublishObject(s3, bucket, key),
    // onMutate runs at mutate()-call time (actual issue order), unlike
    // onSuccess which runs in response-arrival order; see tag-cache.ts.
    onMutate: ({ key }) => ({ token: beginPublicStateChange(bucket, key) }),
    onSuccess: (_result, { key, makePublic }, context) =>
      applyPublicState(queryClient, bucket, key, makePublic, context.token),
    onError: (_error, { key }, context) =>
      context === undefined ? undefined : revertPublicStateOnFailure(queryClient, bucket, key, context.token),
  })

  const url = publicUrl(config.publicBase, bucket, fileKey)
  const name = entryName(fileKey)

  return (
    <div className="flex items-start gap-3">
      <Toggle
        checked={isPublic === true}
        disabled={isPublic === undefined || mutation.isPending}
        onChange={(next) => mutation.mutate({ key: fileKey, makePublic: next })}
        ariaLabel={t("publish.toggleAriaLabel", { name })}
      />
      <div className="min-w-0 flex-1">
        <p className="text-fs-body-sm font-semibold text-ink">{t("publish.title")}</p>
        {isPublic === undefined
          ? <p className="mt-1 text-fs-body-sm text-ink-soft">{t("publish.loading")}</p>
          : isPublic
            ? (
              <div className="mt-1.5">
                <CopyField
                  value={url}
                  ariaLabel={t("publish.publicUrlLabel")}
                  copyLabel={t("common.copy")}
                  copiedLabel={t("common.copied")}
                />
              </div>
            )
            : <p className="mt-1 break-all font-mono text-fs-micro text-ink-soft">{url}</p>}
        {mutation.isError ? (
          <div className="mt-2">
            <Callout tone="warn" role="alert">{t("publish.failed")}</Callout>
          </div>
        ) : null}
      </div>
    </div>
  )
}
