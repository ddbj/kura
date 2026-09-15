import { createContext, type ReactNode, useContext } from "react"
import { z } from "zod"

// Deployment-specific values, baked into the bundle at build time from the
// VITE_KURA_* env vars. The OIDC redirect URI is derived from
// window.location.origin and is deliberately not part of this.
const httpUrl = z.url({ protocol: /^https?$/ })

// The stack's default per-user quota, in MB. Mirrors the specified default of
// 1 TB and the value the reconciler applies when the deployment sets nothing.
const DEFAULT_QUOTA_MB = 1024 * 1024

// Env vars arrive as decimal strings. Empty (or absent) means the deployment
// left the value at its default.
const megabytes = (fallbackMb: number) =>
  z
    .union([
      z.literal("").transform(() => fallbackMb),
      z.string().regex(/^[1-9][0-9]*$/).transform(Number),
    ])
    .default(fallbackMb)
    .transform((mb) => mb * 1024 ** 2)

export const AppConfigSchema = z.object({
  oidcIssuer: httpUrl,
  oidcClientId: z.string().min(1),
  s3Endpoint: httpUrl,
  // Empty (or absent) means the deployment has no file TTL.
  fileTtlDays: z
    .union([
      z.literal("").transform(() => null),
      z.string().regex(/^[1-9][0-9]*$/).transform(Number),
    ])
    .default(null),
  // Denominator of the usage meter. This is the deployment default, not the
  // authoritative per-bucket quota: S3 exposes no way to read the latter, so a
  // quota changed for an individual user is not reflected here.
  quotaBytes: megabytes(DEFAULT_QUOTA_MB),
})

export type AppConfig = z.infer<typeof AppConfigSchema>

// A malformed or missing value is a deployment mistake, not a runtime
// condition, so this throws rather than falling back to a default.
export const readConfig = (
  env: Record<string, string | undefined> = import.meta.env,
): AppConfig =>
  AppConfigSchema.parse({
    oidcIssuer: env["VITE_KURA_OIDC_ISSUER"],
    oidcClientId: env["VITE_KURA_OIDC_CLIENT_ID"],
    s3Endpoint: env["VITE_KURA_S3_ENDPOINT"],
    fileTtlDays: env["VITE_KURA_FILE_TTL_DAYS"] ?? "",
    quotaBytes: env["VITE_KURA_QUOTA_DEFAULT_MB"] ?? "",
  })

const ConfigContext = createContext<AppConfig | null>(null)

export const ConfigProvider = ({ value, children }: { children: ReactNode; value: AppConfig }) => (
  <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
)

export const useConfig = (): AppConfig => {
  const config = useContext(ConfigContext)
  if (config === null) {
    throw new Error("useConfig must be used within a ConfigProvider")
  }
  return config
}
