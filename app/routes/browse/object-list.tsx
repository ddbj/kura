import { Link } from "react-router"

import { formatSize } from "~/lib/format"
import { formatDateTimeLocalized, useLang, useT } from "~/lib/i18n"
import type { FileEntry } from "~/lib/s3"
import { dirName, entryName, prefixToUrlPath } from "~/lib/s3"
import { Button, Card, FolderIcon, Tag, TrashIcon } from "~/ui"

import { DownloadButton } from "./download-button"
import { ShareControl } from "./presign-controls"
import { PublicControl } from "./public-control"

type ObjectListProps = {
  bucket: string
  dirs: string[]
  files: FileEntry[]
  // Per-key public flag; undefined = not fetched yet (no badge shown).
  publicFlags: Map<string, boolean | undefined>
  // Expiry date per file when the deployment has a file TTL, null otherwise.
  expiresAt: (file: FileEntry) => Date | null
  onDelete: (key: string) => void
}

// Every file's controls (download, public toggle, share URL, delete) render
// up front, always: docs/architecture.md's four use cases should each be one
// visible action, not one hidden behind a disclosure click.
export const ObjectList = ({ bucket, dirs, files, publicFlags, expiresAt, onDelete }: ObjectListProps) => {
  const t = useT()
  const lang = useLang()

  return (
    <ul aria-label={t("browse.fileListLabel")} className="flex flex-col gap-3">
      {dirs.map((dir) => (
        <li key={dir}>
          <Card padding="sm">
            <Link
              to={`/_browse/${prefixToUrlPath(dir)}`}
              className="inline-flex items-center gap-2 font-semibold text-brand no-underline hover:underline underline-offset-2"
            >
              <FolderIcon size={16} />
              {dirName(dir)}/
            </Link>
          </Card>
        </li>
      ))}
      {files.map((file) => {
        const expiry = expiresAt(file)

        return (
          <li key={file.key}>
            <Card padding="md" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="break-all font-semibold text-ink">{entryName(file.key)}</p>
                    {publicFlags.get(file.key) === true && (
                      <Tag kind="status" tone="success">{t("publish.badge")}</Tag>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-fs-body-sm text-ink-mid">
                    <span>{formatSize(file.size)}</span>
                    <span aria-hidden className="text-ink-softer">・</span>
                    <span>{formatDateTimeLocalized(file.lastModified, lang)}</span>
                    {expiry !== null && (
                      <>
                        <span aria-hidden className="text-ink-softer">・</span>
                        <span>{t("browse.expiresAt")}: {formatDateTimeLocalized(expiry, lang)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <DownloadButton bucket={bucket} fileKey={file.key} />
                  <Button kind="danger" size="sm" onClick={() => onDelete(file.key)}>
                    <TrashIcon size={14} />
                    {t("browse.delete")}
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 border-t border-border-soft pt-4 sm:grid-cols-2">
                <PublicControl bucket={bucket} fileKey={file.key} isPublic={publicFlags.get(file.key)} />
                <ShareControl bucket={bucket} fileKey={file.key} />
              </div>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
