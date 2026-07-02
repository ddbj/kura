import "@fontsource-variable/noto-sans-jp"
import "./styles/tailwind.css"

import { QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { useState } from "react"
import { AuthProvider } from "react-oidc-context"
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router"

import { oidcProviderProps } from "~/lib/auth"
import { ConfigProvider, fetchConfig } from "~/lib/config"
import { LangProvider } from "~/lib/i18n"
import { createQueryClient } from "~/lib/query"

import type { Route } from "./+types/root"

export const clientLoader = async () => fetchConfig()

export const Layout = ({ children }: { children: ReactNode }) => (
  <html lang="ja">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>kura</title>
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <Meta />
      <Links />
    </head>
    <body>
      {children}
      <ScrollRestoration />
      <Scripts />
    </body>
  </html>
)

// Rendered into the prebuilt index.html shell until the clientLoader resolves;
// it shows before i18n exists, so the text is intentionally untranslated.
export const HydrateFallback = () => <p className="p-md text-ink-soft">Loading…</p>

export const ErrorBoundary = () => {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Unknown error"
  return <p className="p-md">{message}</p>
}

const App = ({ loaderData }: Route.ComponentProps) => {
  const [queryClient] = useState(createQueryClient)
  return (
    <ConfigProvider value={loaderData}>
      <AuthProvider {...oidcProviderProps(loaderData)}>
        <QueryClientProvider client={queryClient}>
          <LangProvider>
            <Outlet />
          </LangProvider>
        </QueryClientProvider>
      </AuthProvider>
    </ConfigProvider>
  )
}

export default App
