import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { SidebarGroupLabel } from "~/ui/sidebar-group-label"

describe("SidebarGroupLabel", () => {
  test("SidebarGroupLabel_default_appliesMonoSmallCapsTokens", () => {
    render(<SidebarGroupLabel>生物種</SidebarGroupLabel>)
    const label = screen.getByText("生物種")
    expect(label).toHaveClass("text-fs-label")
    expect(label).toHaveClass("font-bold")
    expect(label).toHaveClass("text-ink-mid")
    expect(label).toHaveClass("tracking-label")
  })

  test("SidebarGroupLabel_action_rendersActionNode", () => {
    render(
      <SidebarGroupLabel action={<span data-testid="action">解除</span>}>
        生物種
      </SidebarGroupLabel>,
    )
    expect(screen.getByTestId("action")).toBeInTheDocument()
  })

  test("SidebarGroupLabel_noAction_doesNotRenderActionSlot", () => {
    render(<SidebarGroupLabel>生物種</SidebarGroupLabel>)
    expect(screen.queryByTestId("action")).toBeNull()
  })
})
