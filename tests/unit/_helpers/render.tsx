import { QueryClientProvider } from "@tanstack/react-query"
import { render, type RenderResult } from "@testing-library/react"
import { AuthProvider } from "react-oidc-context"
import { createRoutesStub } from "react-router"

import { oidcProviderProps } from "~/lib/auth"
import type { AppConfig } from "~/lib/config"
import { ConfigProvider } from "~/lib/config"
import type { Lang } from "~/lib/i18n"
import { LangProvider } from "~/lib/i18n"
import { createQueryClient } from "~/lib/query"
import { OverlayProviders } from "~/shell"

export const testConfig: AppConfig = {
  oidcIssuer: "https://idp.test/realms/master",
  oidcClientId: "kura-test",
  s3Endpoint: "http://localhost:28333",
  publicBase: "http://localhost:28080",
  fileTtlDays: null,
}

type Routes = Parameters<typeof createRoutesStub>[0]

export type RenderWithStubOptions = {
  routes: Routes
  initialEntries: string[]
  lang?: Lang
  config?: AppConfig
}

// Mirrors the provider tree of app/root.tsx so components under test run
// against the real AuthProvider / LangProvider, not mocks.
export const renderWithStub = ({
  routes,
  initialEntries,
  lang = "ja",
  config = testConfig,
}: RenderWithStubOptions): RenderResult => {
  const Stub = createRoutesStub(routes)

  return render(
    <ConfigProvider value={config}>
      <AuthProvider {...oidcProviderProps(config)}>
        <QueryClientProvider client={createQueryClient()}>
          <LangProvider initialLang={lang}>
            <OverlayProviders>
              <Stub initialEntries={initialEntries} />
            </OverlayProviders>
          </LangProvider>
        </QueryClientProvider>
      </AuthProvider>
    </ConfigProvider>,
  )
}
