import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { Page } from "~/ui/page"

const wrapperClasses = [
  "min-h-full",
  "w-full",
  "bg-surface",
  "text-ink",
  "font-sans",
  "text-fs-body",
  "leading-relaxed",
] as const

describe("Page", () => {
  test("Page_children_areRendered", () => {
    render(
      <Page>
        <span>page-body</span>
      </Page>,
    )
    expect(screen.getByText("page-body")).toBeInTheDocument()
  })

  test("Page_wrapper_appliesBaseClassTokens", () => {
    render(
      <Page>
        <span data-testid="body" />
      </Page>,
    )
    const wrapper = screen.getByTestId("body").parentElement
    expect(wrapper).not.toBeNull()
    expect(wrapper).toHaveClass(...wrapperClasses)
  })

  test("Page_wrapper_doesNotApplyInlineStyle", () => {
    render(
      <Page>
        <span data-testid="body" />
      </Page>,
    )
    const wrapper = screen.getByTestId("body").parentElement
    expect(wrapper).not.toHaveAttribute("style")
  })
})
