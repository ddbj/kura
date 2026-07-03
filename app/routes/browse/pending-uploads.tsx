import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { formatSize } from "~/lib/format"
import { formatDateTimeLocalized, useLang, useT } from "~/lib/i18n"
import type { PendingUpload } from "~/lib/s3"
import { abortPendingUpload, listPendingUploads, listUploadedParts, useS3 } from "~/lib/s3"
import { useUploads } from "~/shell"
import { Button, FilePickButton, Modal, ModalBody, ModalFooter, ModalHeader } from "~/ui"

// Interrupted multipart uploads under the current prefix, discovered on the
// server (they survive reloads). Resuming needs the file to be re-selected:
// browsers cannot keep File handles across sessions. Content safety is
// enforced by the MD5 verification in the resume flow, not here.
export const PendingUploads = ({ bucket, prefix }: { bucket: string; prefix: string }) => {
  const t = useT()
  const lang = useLang()
  const s3 = useS3()
  const queryClient = useQueryClient()
  const { activeKeys, resumePendingUpload } = useUploads()
  const [discardTarget, setDiscardTarget] = useState<PendingUpload | null>(null)

  const pending = useQuery({
    queryKey: ["pendingUploads", bucket, prefix],
    queryFn: () => listPendingUploads(s3, bucket, prefix),
  })
  const uploads = (pending.data ?? []).filter((upload) => !activeKeys.has(`${bucket}/${upload.key}`))

  // SeaweedFS reports no start time for an upload, so progress and recency
  // come from its parts.
  const partInfo = useQueries({
    queries: uploads.map((upload) => ({
      queryKey: ["pendingUploadParts", bucket, upload.key, upload.uploadId],
      queryFn: async () => {
        const parts = await listUploadedParts(s3, bucket, upload.key, upload.uploadId)

        return {
          uploadedBytes: parts.reduce((sum, part) => sum + part.size, 0),
          lastActivity: parts.reduce<Date | null>(
            (max, part) =>
              part.lastModified !== undefined && (max === null || part.lastModified > max)
                ? part.lastModified
                : max,
            null,
          ),
        }
      },
    })),
  })

  const discard = useMutation({
    mutationFn: (upload: PendingUpload) => abortPendingUpload(s3, bucket, upload.key, upload.uploadId),
    onSuccess: () => {
      setDiscardTarget(null)
      void queryClient.invalidateQueries({ queryKey: ["pendingUploads", bucket] })
    },
  })

  if (uploads.length === 0) return null

  return (
    <section aria-labelledby="pending-uploads-title" className="mb-4 rounded-lg border border-line bg-paper-soft p-4">
      <h2 id="pending-uploads-title" className="mb-2 text-sm font-semibold text-ink-mid">
        {t("pendingUploads.title")}
      </h2>
      <ul className="flex flex-col gap-2">
        {uploads.map((upload, index) => {
          const info = partInfo[index]?.data

          return (
            <li
              key={`${upload.key}:${upload.uploadId}`}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <span className="block truncate font-medium">{upload.key.slice(prefix.length)}</span>
                {info === undefined ? null : (
                  <span className="block text-xs text-ink-soft">
                    {t("pendingUploads.uploadedInfo", {
                      size: formatSize(info.uploadedBytes),
                      datetime: info.lastActivity === null
                        ? "-"
                        : formatDateTimeLocalized(info.lastActivity, lang),
                    })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <FilePickButton
                  multiple={false}
                  kind="secondary"
                  size="sm"
                  onPick={([file]) => {
                    if (file !== undefined) {
                      resumePendingUpload(bucket, upload.key, upload.uploadId, file)
                    }
                  }}
                >
                  {t("pendingUploads.pickToResume")}
                </FilePickButton>
                <Button kind="ghost" size="sm" onClick={() => setDiscardTarget(upload)}>
                  {t("pendingUploads.discard")}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      <Modal
        open={discardTarget !== null}
        onClose={() => setDiscardTarget(null)}
        ariaLabelledby="discard-upload-title"
        width={480}
      >
        <ModalHeader
          title={t("pendingUploads.discardConfirmTitle")}
          titleId="discard-upload-title"
          onClose={() => setDiscardTarget(null)}
        />
        <ModalBody minHeight={0}>
          <p>{t("pendingUploads.discardConfirmBody", { name: discardTarget?.key.slice(prefix.length) ?? "" })}</p>
        </ModalBody>
        <ModalFooter
          actions={
            <>
              <Button kind="secondary" onClick={() => setDiscardTarget(null)} disabled={discard.isPending}>
                {t("common.cancel")}
              </Button>
              <Button
                kind="danger"
                onClick={() => {
                  if (discardTarget !== null) discard.mutate(discardTarget)
                }}
                disabled={discard.isPending}
              >
                {t("pendingUploads.discard")}
              </Button>
            </>
          }
        />
      </Modal>
    </section>
  )
}
