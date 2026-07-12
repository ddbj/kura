import type { ReactNode } from "react"

import { IconSprite } from "~/ui"

// Top-level app shell: just mounts the SVG sprite. The header lives inside the
// authenticated branch so the login screen renders as a full-viewport centred
// card (design_handoff #10).
export const ShellLayout = ({ children }: { children: ReactNode }) => (
  <>
    <IconSprite />
    {children}
  </>
)
