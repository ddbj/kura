import type { ReactNode } from "react"

import { UploadsProvider } from "./uploads"

// Global providers that must survive route transitions. UploadsProvider keeps
// upload transfers alive so the upcard renders across navigation.
export const OverlayProviders = ({ children }: { children: ReactNode }) => (
  <UploadsProvider>{children}</UploadsProvider>
)
