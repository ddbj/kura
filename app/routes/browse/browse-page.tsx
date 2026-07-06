import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { DragEvent } from "react"
import { useRef, useState } from "react"

import { useUsername } from "~/lib/auth"
import { useConfig } from "~/lib/config"
import { useT } from "~/lib/i18n"
import type { FileEntry } from "~/lib/s3"
import { deleteObject, ensureOwnBucket, isUsableBucketName, listDirectory, useObjectPublicFlags, useS3 } from "~/lib/s3"
import { RequireAuth, useUploads } from "~/shell"
import { Button, Callout, Card, FilePickButton, FolderIcon, Heading, Section, UploadIcon } from "~/ui"

import { DeleteDialog } from "./delete-dialog"
import { Landing } from "./landing"
import { ObjectList } from "./object-list"
import { PendingUploads } from "./pending-uploads"
import { PrefixBreadcrumb } from "./prefix-breadcrumb"
import { UploadUrlControl } from "./presign-controls"
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

  // dragCounter survives nested dragenter/dragleave pairs firing on child
  // elements as the pointer moves inside the drop area (a plain boolean
  // would flicker to false on every child boundary crossing).
  const [isDragActive, setIsDragActive] = useState(false)
  const dragCounter = useRef(0)

  const hasFiles = (e: DragEvent<HTMLDivElement>): boolean => Array.from(e.dataTransfer.types).includes("Files")

  const handleDragEnter = (e: DragEvent<HTMLDivElement>): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragCounter.current += 1
    setIsDragActive(true)
  }
  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
  }
  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setIsDragActive(false)
  }
  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragCounter.current = 0
    setIsDragActive(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length > 0) startUploads(username, prefix, dropped)
  }

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
      <Section>
        <div className="flex flex-col items-start gap-4">
          <Callout tone="warn" role="alert">{t("bucket.prepareErrorTitle")}</Callout>
          <Button kind="secondary" onClick={() => void bucket.refetch()}>{t("common.retry")}</Button>
        </div>
      </Section>
    )
  }
  if (bucket.isPending || list.isPending) {
    return (
      <Section>
        <p className="text-ink-soft">{bucket.isPending ? t("bucket.preparing") : t("common.loading")}</p>
      </Section>
    )
  }
  if (list.isError) {
    return (
      <Section>
        <div className="flex flex-col items-start gap-4">
          <Callout tone="warn" role="alert">{t("browse.listErrorTitle")}</Callout>
          <Button kind="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>
        </div>
      </Section>
    )
  }

  const isEmpty = dirs.length === 0 && files.length === 0

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragActive && (
        <div className="pointer-events-none fixed inset-0 z-modal flex items-center justify-center bg-ink/10 p-8">
          <div className="rounded-card border-2 border-dashed border-brand bg-surface px-12 py-10 text-center shadow-modal">
            <UploadIcon size={28} className="mx-auto text-brand" />
            <p className="mt-3 font-semibold text-ink">{t("upload.dropHint")}</p>
          </div>
        </div>
      )}
      <Section>
        <Heading as="h1">{t("browse.pageTitle")}</Heading>
        <p className="mt-1 mb-5 text-fs-body-sm text-ink-mid">{t("browse.pageDescription")}</p>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <PrefixBreadcrumb prefix={prefix} />
          <FilePickButton onPick={(picked) => startUploads(username, prefix, picked)}>
            {t("upload.button")}
          </FilePickButton>
        </div>
        <div className="mb-4">
          <Card tone="subtle" padding="md">
            <UploadUrlControl bucket={username} prefix={prefix} />
          </Card>
        </div>
        <PendingUploads bucket={username} prefix={prefix} />
        {isEmpty
          ? (
            <Card padding="md" className="flex flex-col items-center gap-3 py-14 text-center">
              <FolderIcon size={32} className="text-ink-softer" />
              <div>
                <Heading as="h2" size="h3">{t("browse.emptyTitle")}</Heading>
                <p className="mt-1 text-fs-body-sm text-ink-mid">{t("browse.empty")}</p>
              </div>
              <FilePickButton onPick={(picked) => startUploads(username, prefix, picked)}>
                {t("upload.button")}
              </FilePickButton>
            </Card>
          )
          : (
            <ObjectList
              bucket={username}
              dirs={dirs}
              files={files}
              publicFlags={publicFlags}
              expiresAt={fileExpiresAt}
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
      </Section>
    </div>
  )
}

export const BrowsePage = ({ prefix }: { prefix: string }) => (
  <RequireAuth fallback={(signin) => <Landing onSignIn={signin} />}>
    <BrowseContent prefix={prefix} />
  </RequireAuth>
)
