import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { useUsername } from "~/lib/auth"
import { useT } from "~/lib/i18n"
import { deleteObject, ensureOwnBucket, isUsableBucketName, listDirectory, useS3 } from "~/lib/s3"
import { RequireAuth } from "~/shell"
import { Button, Callout } from "~/ui"

import { DeleteDialog } from "./delete-dialog"
import { ObjectList } from "./object-list"
import { PrefixBreadcrumb } from "./prefix-breadcrumb"
import { UnsupportedUsername } from "./unsupported-username"

const BrowseContent = ({ prefix }: { prefix: string }) => {
  const t = useT()
  const username = useUsername()
  const s3 = useS3()
  const queryClient = useQueryClient()
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

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const deletion = useMutation({
    mutationFn: (key: string) => deleteObject(s3, username, key),
    onSuccess: () => {
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: ["objects", username] })
    },
  })

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

  const dirs = list.data.pages.flatMap((page) => page.dirs)
  const files = list.data.pages.flatMap((page) => page.files)

  return (
    <div className="p-6">
      <PrefixBreadcrumb prefix={prefix} />
      {dirs.length === 0 && files.length === 0
        ? <p className="text-ink-soft">{t("browse.empty")}</p>
        : <ObjectList bucket={username} dirs={dirs} files={files} onDelete={setDeleteTarget} />}
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
    </div>
  )
}

export const BrowsePage = ({ prefix }: { prefix: string }) => (
  <RequireAuth>
    <BrowseContent prefix={prefix} />
  </RequireAuth>
)
