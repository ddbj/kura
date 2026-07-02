import type { ReactNode } from "react"

import { Page } from "~/ui"

import { Header } from "./header"
import { SkipLink } from "./skip-link"

export const ShellLayout = ({ children }: { children: ReactNode }) => (
  <Page>
    <SkipLink />
    <Header />
    <main id="main" className="min-h-[60vh]">{children}</main>
  </Page>
)
