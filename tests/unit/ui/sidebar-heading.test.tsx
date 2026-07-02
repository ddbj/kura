import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { SidebarHeading } from "~/ui/sidebar-heading"

describe("SidebarHeading", () => {
  test("SidebarHeading_default_appliesH3WithBrandBar", () => {
    render(<SidebarHeading>側面見出し</SidebarHeading>)
    const node = screen.getByRole("heading", { level: 3, name: "側面見出し" })
    expect(node).toHaveClass("text-fs-h3")
    expect(node).toHaveClass("font-bold")
    expect(node).toHaveClass("text-ink")
    expect(node).toHaveClass("m-0")
    expect(node).toHaveClass("tracking-h3")
    expect(node).toHaveClass("leading-tight")
    expect(node).toHaveClass("pl-2.5")
    expect(node).toHaveClass("border-l-[3px]")
    expect(node).toHaveClass("border-brand")
  })

  test("SidebarHeading_asH2_rendersAsH2", () => {
    render(<SidebarHeading as="h2">x</SidebarHeading>)
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument()
  })

  test("SidebarHeading_id_appliesToHeading", () => {
    render(<SidebarHeading id="side-1">x</SidebarHeading>)
    expect(screen.getByRole("heading", { level: 3 })).toHaveAttribute("id", "side-1")
  })

  test("SidebarHeading_action_rendersActionNode", () => {
    render(<SidebarHeading action={<span data-testid="action">A</span>}>x</SidebarHeading>)
    expect(screen.getByTestId("action")).toBeInTheDocument()
  })

  test("SidebarHeading_noAction_doesNotRenderActionSlot", () => {
    render(<SidebarHeading>x</SidebarHeading>)
    expect(screen.queryByTestId("action")).toBeNull()
  })
})
