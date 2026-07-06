import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useAuth } from "react-oidc-context"

import { useConfig } from "~/lib/config"
import { formatDateTimeLocalized, useLang, useT } from "~/lib/i18n"
import type { PresignedShare, PresignMethod } from "~/lib/s3"
import { accessTokenForDuration, presignShareUrl } from "~/lib/s3"
import { Button, Callout, CopyField, MonoCode, Select, TextInput } from "~/ui"

const DEFAULT_EXPIRES_S = 900

// Each issuance mints a fresh STS session (app/lib/s3/presign.ts), so the URL
// lifetime is capped only by the session length.
const usePresign = (bucket: string, method: PresignMethod) => {
  const config = useConfig()
  const auth = useAuth()

  return useMutation({
    mutationFn: async ({ key, expiresInSeconds }: { key: string; expiresInSeconds: number }) => {
      const token = await accessTokenForDuration(auth, expiresInSeconds)

      return presignShareUrl({ endpoint: config.s3Endpoint, token, bucket, key, method, expiresInSeconds })
    },
  })
}

const ExpiresSelect = ({ value, onChange }: { value: number; onChange: (seconds: number) => void }) => {
  const t = useT()

  return (
    <div className="flex items-center gap-2">
      <span className="text-fs-body-sm text-ink-mid">{t("presign.expiresLabel")}</span>
      <Select
        ariaLabel={t("presign.expiresLabel")}
        options={[
          { value: "900", label: t("presign.minutes15") },
          { value: "3600", label: t("presign.hour1") },
        ]}
        value={String(value)}
        onChange={(next) => onChange(Number(next))}
        width={140}
        size="md"
      />
    </div>
  )
}

const PresignResult = ({ share }: { share: PresignedShare }) => {
  const t = useT()
  const lang = useLang()

  return (
    <div className="mt-2 flex flex-col gap-2">
      <CopyField
        value={share.url}
        ariaLabel={t("presign.urlLabel")}
        copyLabel={t("common.copy")}
        copiedLabel={t("common.copied")}
      />
      <p className="text-fs-micro text-ink-soft">
        {t("presign.expiresAt", { datetime: formatDateTimeLocalized(share.expiresAt, lang) })}
      </p>
    </div>
  )
}

// Always rendered next to the file it belongs to (no click-to-reveal): the
// duration + issue control is visible up front, only the result appears once
// issued (issuing has a real side effect, so it cannot pre-populate itself).
export const ShareControl = ({ bucket, fileKey }: { bucket: string; fileKey: string }) => {
  const t = useT()
  const [expiresIn, setExpiresIn] = useState(DEFAULT_EXPIRES_S)
  const presign = usePresign(bucket, "GET")

  return (
    <div className="min-w-0 flex-1">
      <p className="text-fs-body-sm font-semibold text-ink">{t("presign.getTitle")}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <ExpiresSelect value={expiresIn} onChange={setExpiresIn} />
        <Button
          size="sm"
          disabled={presign.isPending}
          onClick={() => presign.mutate({ key: fileKey, expiresInSeconds: expiresIn })}
        >
          {t("presign.issue")}
        </Button>
      </div>
      {presign.isError ? (
        <div className="mt-2">
          <Callout tone="warn" role="alert">{t("presign.failed")}</Callout>
        </div>
      ) : null}
      {presign.isSuccess ? <PresignResult share={presign.data} /> : null}
    </div>
  )
}

// Page-level control (not tied to a file): always visible below the
// toolbar, same reasoning as ShareControl.
export const UploadUrlControl = ({ bucket, prefix }: { bucket: string; prefix: string }) => {
  const t = useT()
  const [filename, setFilename] = useState("")
  const [expiresIn, setExpiresIn] = useState(DEFAULT_EXPIRES_S)
  const presign = usePresign(bucket, "PUT")
  const trimmedFilename = filename.trim()
  const filenameInvalid = trimmedFilename === "" || trimmedFilename.includes("/") || trimmedFilename.includes("..")

  return (
    <section aria-label={t("presign.putTitle")} className="flex flex-col gap-2">
      <p className="text-fs-body-sm font-semibold text-ink">{t("presign.putTitle")}</p>
      <Callout tone="info">{t("presign.note")}</Callout>
      <div className="flex flex-wrap items-center gap-2">
        {prefix === "" ? null : <MonoCode className="text-fs-body-sm text-ink-mid">{prefix}</MonoCode>}
        <TextInput
          ariaLabel={t("presign.filenameLabel")}
          placeholder={t("presign.filenameLabel")}
          value={filename}
          grow
          onChange={(event) => setFilename(event.currentTarget.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ExpiresSelect value={expiresIn} onChange={setExpiresIn} />
        <Button
          size="sm"
          disabled={presign.isPending || filenameInvalid}
          onClick={() => presign.mutate({ key: `${prefix}${trimmedFilename}`, expiresInSeconds: expiresIn })}
        >
          {t("presign.issue")}
        </Button>
      </div>
      {presign.isError ? <Callout tone="warn" role="alert">{t("presign.failed")}</Callout> : null}
      {presign.isSuccess
        ? (
          <>
            <PresignResult share={presign.data} />
            <p className="text-fs-body-sm text-ink-mid">{t("presign.putUsage")}</p>
            <MonoCode className="break-all text-fs-body-sm text-ink-mid">
              {`curl -T <file> '${presign.data.url}'`}
            </MonoCode>
          </>
        )
        : null}
    </section>
  )
}
