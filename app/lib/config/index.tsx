import { createContext, type ReactNode, useContext } from "react"
import { z } from "zod"

// Deployment-specific values baked into /_config.json by nginx from env vars
// (served by a vite middleware in dev). The OIDC redirect URI is derived from
// window.location.origin and is deliberately not part of this config.
const httpUrl = z.url({ protocol: /^https?$/ })

export const AppConfigSchema = z.object({
  oidcIssuer: httpUrl,
  oidcClientId: z.string().min(1),
  s3Endpoint: httpUrl,
  publicBase: httpUrl,
  // envsubst bakes env vars as strings, so the TTL arrives as a decimal
  // string; empty (or absent) means the deployment has no file TTL.
  fileTtlDays: z
    .union([
      z.literal("").transform(() => null),
      z.string().regex(/^[1-9][0-9]*$/).transform(Number),
    ])
    .default(null),
})

export type AppConfig = z.infer<typeof AppConfigSchema>

export const fetchConfig = async (): Promise<AppConfig> => {
  const res = await fetch("/_config.json")
  if (!res.ok) {
    throw new Error(`GET /_config.json responded with ${res.status}`)
  }
  return AppConfigSchema.parse(await res.json())
}

const ConfigContext = createContext<AppConfig | null>(null)

export const ConfigProvider = ({ value, children }: { value: AppConfig; children: ReactNode }) => (
  <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
)

export const useConfig = (): AppConfig => {
  const config = useContext(ConfigContext)
  if (config === null) {
    throw new Error("useConfig must be used within a ConfigProvider")
  }
  return config
}
