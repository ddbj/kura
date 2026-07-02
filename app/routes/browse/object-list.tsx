import { Link } from "react-router"

import { formatSize } from "~/lib/format"
import { formatDateTimeLocalized, useLang, useT } from "~/lib/i18n"
import type { FileEntry } from "~/lib/s3"
import { dirName, entryName, prefixToUrlPath } from "~/lib/s3"
import { Button, FolderIcon, Tag } from "~/ui"

import { DownloadButton } from "./download-button"

type ObjectListProps = {
  bucket: string
  dirs: string[]
  files: FileEntry[]
  // Per-key public flag; undefined = not fetched yet (no badge shown).
  publicFlags: Map<string, boolean | undefined>
  // Expiry date per file when the deployment has a file TTL, null otherwise.
  expiresAt: (file: FileEntry) => Date | null
  onPublicSettings: (key: string) => void
  onShare: (key: string) => void
  onDelete: (key: string) => void
}

const headerCell = "px-3 py-2 text-left text-fs-body-sm font-semibold text-ink-mid border-b border-border-soft"
const cell = "px-3 py-2 border-b border-border-softer text-fs-body"

export const ObjectList = ({ bucket, dirs, files, publicFlags, expiresAt, onPublicSettings, onShare, onDelete }: ObjectListProps) => {
  const t = useT()
  const lang = useLang()
  const showExpiry = files.some((file) => expiresAt(file) !== null)
  const nameColumns = showExpiry ? 4 : 3

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th scope="col" className={headerCell}>{t("browse.name")}</th>
          <th scope="col" className={`${headerCell} w-28`}>{t("browse.size")}</th>
          <th scope="col" className={`${headerCell} w-44`}>{t("browse.lastModified")}</th>
          {showExpiry ? <th scope="col" className={`${headerCell} w-44`}>{t("browse.expiresAt")}</th> : null}
          <th scope="col" className={`${headerCell} w-80`}>
            <span className="sr-only">actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {dirs.map((dir) => (
          <tr key={dir}>
            <td className={cell} colSpan={nameColumns}>
              <Link
                to={`/_browse/${prefixToUrlPath(dir)}`}
                className="inline-flex items-center gap-2 text-brand no-underline hover:underline underline-offset-2"
              >
                <FolderIcon size={16} />
                {dirName(dir)}/
              </Link>
            </td>
            <td className={cell} />
          </tr>
        ))}
        {files.map((file) => {
          const expiry = expiresAt(file)

          return (
            <tr key={file.key}>
              <td className={`${cell} break-all`}>
                <span className="inline-flex flex-wrap items-center gap-2">
                  {entryName(file.key)}
                  {publicFlags.get(file.key) === true && (
                    <Tag kind="status" tone="success">{t("publish.badge")}</Tag>
                  )}
                </span>
              </td>
              <td className={`${cell} whitespace-nowrap text-ink-mid`}>{formatSize(file.size)}</td>
              <td className={`${cell} whitespace-nowrap text-ink-mid`}>{formatDateTimeLocalized(file.lastModified, lang)}</td>
              {showExpiry
                ? (
                  <td className={`${cell} whitespace-nowrap text-ink-mid`}>
                    {expiry === null ? "" : formatDateTimeLocalized(expiry, lang)}
                  </td>
                )
                : null}
              <td className={`${cell} text-right whitespace-nowrap`}>
                <DownloadButton bucket={bucket} fileKey={file.key} />
                <Button kind="ghost" size="sm" onClick={() => onPublicSettings(file.key)}>
                  {t("publish.button")}
                </Button>
                <Button kind="ghost" size="sm" onClick={() => onShare(file.key)}>
                  {t("presign.button")}
                </Button>
                <Button kind="ghost" size="sm" onClick={() => onDelete(file.key)}>
                  {t("browse.delete")}
                </Button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
