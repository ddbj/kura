import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { useUsername } from "~/lib/auth"
import { useConfig } from "~/lib/config"
import { useT } from "~/lib/i18n"
import type { FileEntry } from "~/lib/s3"
import { deleteObject, ensureOwnBucket, isUsableBucketName, listDirectory, useObjectPublicFlags, useS3 } from "~/lib/s3"
import { RequireAuth, useUploads } from "~/shell"
import { Button, Callout, FilePickButton } from "~/ui"

import { DeleteDialog } from "./delete-dialog"
import { ObjectList } from "./object-list"
import { PendingUploads } from "./pending-uploads"
import { PrefixBreadcrumb } from "./prefix-breadcrumb"
import { PresignGetDialog, PresignPutDialog } from "./presign-dialogs"
import { PublicDialog } from "./public-dialog"
import { UnsupportedUsername } from "./unsupported-username"

const DAY_MS = 24 * 60 * 60 * 1000

const BrowseContent = ({ prefix }: { prefix: string }) => {
  const t = useT()
  const username = useUsername()
  const config = useConfig()
  const s3 = useS3()
  const queryClient = useQueryClient()
  const { startUploads } = useUploads()
  const usable = isUsableBucketName(username)

  // The user's storage is their own bucket; make sure it exists before the
  // first listing (docs/architecture.md 配置).
  const bucket = useQuery({
    queryKey: ["bucket", username],
    queryFn: async () => {
      await ensureOwnBucket(s3, username)
      return true
    },
    staleTime: Infinity,
    enabled: usable,
  })

  const list = useInfiniteQuery({
    queryKey: ["objects", username, prefix],
    queryFn: ({ pageParam }) => listDirectory(s3, username, prefix, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextToken,
    enabled: bucket.isSuccess,
  })

  const dirs = list.data?.pages.flatMap((page) => page.dirs) ?? []
  const files = list.data?.pages.flatMap((page) => page.files) ?? []
  const publicFlags = useObjectPublicFlags(s3, username, files.map((file) => file.key))

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [publicTarget, setPublicTarget] = useState<string | null>(null)
  const [shareTarget, setShareTarget] = useState<string | null>(null)
  const [putDialogOpen, setPutDialogOpen] = useState(false)
  const deletion = useMutation({
    mutationFn: (key: string) => deleteObject(s3, username, key),
    onSuccess: () => {
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: ["objects", username] })
    },
  })

  // requirements.md 全ファイル TTL: expiry = creation time + TTL (S3 objects
  // are immutable, so LastModified is the creation time).
  const fileExpiresAt = (file: FileEntry): Date | null =>
    config.fileTtlDays === null ? null : new Date(file.lastModified.getTime() + config.fileTtlDays * DAY_MS)

  if (!usable) return <UnsupportedUsername username={username} />

  if (bucket.isError) {
    return (
      <div className="flex flex-col items-start gap-4 p-6">
        <Callout tone="warn" role="alert">{t("bucket.prepareErrorTitle")}</Callout>
        <Button kind="secondary" onClick={() => void bucket.refetch()}>{t("common.retry")}</Button>
      </div>
    )
  }
  if (bucket.isPending || list.isPending) {
    return <p className="p-6 text-ink-soft">{bucket.isPending ? t("bucket.preparing") : t("common.loading")}</p>
  }
  if (list.isError) {
    return (
      <div className="flex flex-col items-start gap-4 p-6">
        <Callout tone="warn" role="alert">{t("browse.listErrorTitle")}</Callout>
        <Button kind="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PrefixBreadcrumb prefix={prefix} />
        <div className="flex flex-wrap items-center gap-2">
          <Button kind="secondary" onClick={() => setPutDialogOpen(true)}>{t("presign.putButton")}</Button>
          <FilePickButton onPick={(picked) => startUploads(username, prefix, picked)}>
            {t("upload.button")}
          </FilePickButton>
        </div>
      </div>
      <PendingUploads bucket={username} prefix={prefix} />
      {dirs.length === 0 && files.length === 0
        ? <p className="text-ink-soft">{t("browse.empty")}</p>
        : (
          <ObjectList
            bucket={username}
            dirs={dirs}
            files={files}
            publicFlags={publicFlags}
            expiresAt={fileExpiresAt}
            onPublicSettings={setPublicTarget}
            onShare={setShareTarget}
            onDelete={setDeleteTarget}
          />
        )}
      {list.hasNextPage ? (
        <div className="mt-4">
          <Button kind="secondary" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {t("browse.loadMore")}
          </Button>
        </div>
      ) : null}
      <DeleteDialog
        targetKey={deleteTarget}
        deleting={deletion.isPending}
        failed={deletion.isError}
        onConfirm={() => {
          if (deleteTarget !== null) deletion.mutate(deleteTarget)
        }}
        onCancel={() => {
          setDeleteTarget(null)
          deletion.reset()
        }}
      />
      <PublicDialog
        bucket={username}
        targetKey={publicTarget}
        isPublic={publicTarget === null ? undefined : publicFlags.get(publicTarget)}
        onClose={() => setPublicTarget(null)}
      />
      <PresignGetDialog
        bucket={username}
        targetKey={shareTarget}
        onClose={() => setShareTarget(null)}
      />
      <PresignPutDialog
        bucket={username}
        prefix={prefix}
        open={putDialogOpen}
        onClose={() => setPutDialogOpen(false)}
      />
    </div>
  )
}

export const BrowsePage = ({ prefix }: { prefix: string }) => (
  <RequireAuth>
    <BrowseContent prefix={prefix} />
  </RequireAuth>
)
