import { Link } from "react-router"

import { formatSize } from "~/lib/format"
import { formatDateTimeLocalized, useLang, useT } from "~/lib/i18n"
import type { FileEntry } from "~/lib/s3"
import { dirName, entryName, prefixToUrlPath } from "~/lib/s3"
import { Button, FolderIcon } from "~/ui"

import { DownloadButton } from "./download-button"

type ObjectListProps = {
  bucket: string
  dirs: string[]
  files: FileEntry[]
  onDelete: (key: string) => void
}

const headerCell = "px-3 py-2 text-left text-fs-body-sm font-semibold text-ink-mid border-b border-border-soft"
const cell = "px-3 py-2 border-b border-border-softer text-fs-body"

export const ObjectList = ({ bucket, dirs, files, onDelete }: ObjectListProps) => {
  const t = useT()
  const lang = useLang()
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th scope="col" className={headerCell}>{t("browse.name")}</th>
          <th scope="col" className={`${headerCell} w-28`}>{t("browse.size")}</th>
          <th scope="col" className={`${headerCell} w-44`}>{t("browse.lastModified")}</th>
          <th scope="col" className={`${headerCell} w-56`}>
            <span className="sr-only">actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {dirs.map((dir) => (
          <tr key={dir}>
            <td className={cell} colSpan={3}>
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
        {files.map((file) => (
          <tr key={file.key}>
            <td className={`${cell} break-all`}>{entryName(file.key)}</td>
            <td className={`${cell} whitespace-nowrap text-ink-mid`}>{formatSize(file.size)}</td>
            <td className={`${cell} whitespace-nowrap text-ink-mid`}>{formatDateTimeLocalized(file.lastModified, lang)}</td>
            <td className={`${cell} text-right whitespace-nowrap`}>
              <DownloadButton bucket={bucket} fileKey={file.key} />
              <Button kind="ghost" size="sm" onClick={() => onDelete(file.key)}>
                {t("browse.delete")}
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
