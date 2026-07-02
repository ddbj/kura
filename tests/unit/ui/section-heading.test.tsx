import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { SectionHeading } from "~/ui/section-heading"

describe("SectionHeading", () => {
  test("SectionHeading_default_appliesH2WithBrandLeftBar", () => {
    render(<SectionHeading>見出し</SectionHeading>)
    const node = screen.getByRole("heading", { level: 2, name: "見出し" })
    expect(node).toHaveClass("text-fs-h2")
    expect(node).toHaveClass("font-bold")
    expect(node).toHaveClass("text-ink")
    expect(node).toHaveClass("m-0")
    expect(node).toHaveClass("pl-2.5")
    expect(node).toHaveClass("border-l-[3px]")
    expect(node).toHaveClass("border-brand")
    expect(node).toHaveClass("leading-none")
  })

  test("SectionHeading_asH3_rendersAsH3", () => {
    render(<SectionHeading as="h3">見出し</SectionHeading>)
    expect(screen.getByRole("heading", { level: 3, name: "見出し" })).toBeInTheDocument()
  })

  test("SectionHeading_count_rendersCountAsLabel", () => {
    render(<SectionHeading count={42}>x</SectionHeading>)
    const count = screen.getByText("42")
    expect(count).toHaveClass("text-fs-label")
    expect(count).toHaveClass("text-ink-soft")
  })

  test("SectionHeading_countWithSuffix_rendersCountAndSuffix", () => {
    render(<SectionHeading count={42} countSuffix="件">x</SectionHeading>)
    expect(screen.getByText("42 件")).toBeInTheDocument()
  })

  test("SectionHeading_countSuffixEmpty_rendersCountOnly", () => {
    render(<SectionHeading count={42} countSuffix="">x</SectionHeading>)
    expect(screen.getByText("42")).toBeInTheDocument()
  })

  test("SectionHeading_countZero_rendersZero", () => {
    render(<SectionHeading count={0}>x</SectionHeading>)
    expect(screen.getByText("0")).toBeInTheDocument()
  })

  test("SectionHeading_countUndefined_doesNotRenderCount", () => {
    render(<SectionHeading>x</SectionHeading>)
    expect(screen.queryByText(/^\d+/)).toBeNull()
  })

  test("SectionHeading_subtitle_rendersSubtitleParagraphWithBarAlignedPadding", () => {
    render(<SectionHeading subtitle="補足説明">x</SectionHeading>)
    const sub = screen.getByText("補足説明")
    expect(sub).toHaveClass("text-fs-body-sm")
    expect(sub).toHaveClass("text-ink-mid")
    expect(sub).toHaveClass("pl-2.5")
  })

  test("SectionHeading_subtitleUndefined_doesNotRenderSubtitle", () => {
    const { container } = render(<SectionHeading>x</SectionHeading>)
    expect(container.querySelector("p")).toBeNull()
  })

  test("SectionHeading_action_rendersActionNode", () => {
    render(<SectionHeading action={<span data-testid="action">A</span>}>x</SectionHeading>)
    expect(screen.getByTestId("action")).toBeInTheDocument()
  })

  test("SectionHeading_id_appliesToHeading", () => {
    render(<SectionHeading id="sec-1">x</SectionHeading>)
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute("id", "sec-1")
  })
})
