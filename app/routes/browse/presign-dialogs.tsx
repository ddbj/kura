import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useAuth } from "react-oidc-context"

import { useConfig } from "~/lib/config"
import { formatDateTimeLocalized, useLang, useT } from "~/lib/i18n"
import type { PresignedShare, PresignMethod } from "~/lib/s3"
import { freshAccessToken, presignShareUrl } from "~/lib/s3"
import { Button, Callout, CopyField, Modal, ModalBody, ModalFooter, ModalHeader, MonoCode, Select, TextInput } from "~/ui"

const DEFAULT_EXPIRES_S = 900

// Each issuance mints a fresh STS session (app/lib/s3/presign.ts), so the URL
// lifetime is capped only by the session length.
const usePresign = (bucket: string, method: PresignMethod) => {
  const config = useConfig()
  const auth = useAuth()

  return useMutation({
    mutationFn: async ({ key, expiresInSeconds }: { key: string; expiresInSeconds: number }) => {
      const token = await freshAccessToken(auth)

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
    <div className="flex flex-col gap-2">
      <CopyField
        value={share.url}
        ariaLabel={t("presign.urlLabel")}
        copyLabel={t("common.copy")}
        copiedLabel={t("common.copied")}
      />
      <p className="text-fs-body-sm text-ink-mid">
        {t("presign.expiresAt", { datetime: formatDateTimeLocalized(share.expiresAt, lang) })}
      </p>
    </div>
  )
}

export const PresignGetDialog = ({ bucket, targetKey, onClose }: {
  bucket: string
  targetKey: string | null
  onClose: () => void
}) => {
  const t = useT()
  const [expiresIn, setExpiresIn] = useState(DEFAULT_EXPIRES_S)
  const presign = usePresign(bucket, "GET")
  const close = () => {
    presign.reset()
    setExpiresIn(DEFAULT_EXPIRES_S)
    onClose()
  }

  return (
    <Modal open={targetKey !== null} onClose={close} ariaLabelledby="presign-get-title" width={560}>
      <ModalHeader title={t("presign.getTitle")} titleId="presign-get-title" onClose={close} />
      <ModalBody minHeight={0}>
        <div className="flex flex-col gap-3">
          <MonoCode className="break-all text-fs-body-sm text-ink-mid">{targetKey ?? ""}</MonoCode>
          <Callout tone="info">{t("presign.note")}</Callout>
          <div className="flex flex-wrap items-center gap-3">
            <ExpiresSelect value={expiresIn} onChange={setExpiresIn} />
            <Button
              size="sm"
              disabled={presign.isPending}
              onClick={() => {
                if (targetKey !== null) presign.mutate({ key: targetKey, expiresInSeconds: expiresIn })
              }}
            >
              {t("presign.issue")}
            </Button>
          </div>
          {presign.isError ? <Callout tone="warn" role="alert">{t("presign.failed")}</Callout> : null}
          {presign.isSuccess ? <PresignResult share={presign.data} /> : null}
        </div>
      </ModalBody>
      <ModalFooter actions={<Button kind="secondary" onClick={close}>{t("common.close")}</Button>} />
    </Modal>
  )
}

export const PresignPutDialog = ({ bucket, prefix, open, onClose }: {
  bucket: string
  prefix: string
  open: boolean
  onClose: () => void
}) => {
  const t = useT()
  const [filename, setFilename] = useState("")
  const [expiresIn, setExpiresIn] = useState(DEFAULT_EXPIRES_S)
  const presign = usePresign(bucket, "PUT")
  const close = () => {
    presign.reset()
    setFilename("")
    setExpiresIn(DEFAULT_EXPIRES_S)
    onClose()
  }

  return (
    <Modal open={open} onClose={close} ariaLabelledby="presign-put-title" width={560}>
      <ModalHeader title={t("presign.putTitle")} titleId="presign-put-title" onClose={close} />
      <ModalBody minHeight={0}>
        <div className="flex flex-col gap-3">
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
              disabled={presign.isPending || filename === ""}
              onClick={() => presign.mutate({ key: `${prefix}${filename}`, expiresInSeconds: expiresIn })}
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
        </div>
      </ModalBody>
      <ModalFooter actions={<Button kind="secondary" onClick={close}>{t("common.close")}</Button>} />
    </Modal>
  )
}
