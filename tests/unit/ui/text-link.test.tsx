import { render, screen } from "@testing-library/react"
import { createRoutesStub } from "react-router"
import { describe, expect, test } from "vitest"

import { TextLink } from "~/ui/text-link"

const renderTextLink = (node: React.ReactNode) => {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <>{node}</> },
    { path: "/news", Component: () => <span>news</span> },
  ])
  return render(<Stub />)
}

describe("TextLink", () => {
  test("TextLink_internal_rendersRouterLink", () => {
    renderTextLink(<TextLink to="/news">news</TextLink>)
    const link = screen.getByRole("link", { name: /news/ })
    expect(link).toHaveAttribute("href", "/news")
    expect(link).not.toHaveAttribute("target")
  })

  test("TextLink_internal_withoutArrow_rendersNoIcon", () => {
    renderTextLink(<TextLink to="/news">news</TextLink>)
    expect(screen.getByRole("link", { name: /news/ }).querySelector("svg")).toBeNull()
  })

  test("TextLink_arrow_rendersTrailingDecorativeIconWithoutChangingName", () => {
    renderTextLink(<TextLink to="/news" arrow>news</TextLink>)
    const link = screen.getByRole("link", { name: "news" })
    const icon = link.querySelector("svg")
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute("aria-hidden", "true")
  })

  test("TextLink_external_setsTargetAndRelAndSrLabelAndIcon", () => {
    renderTextLink(
      <TextLink href="https://example.com" external externalSrLabel="external link">
        ext
      </TextLink>,
    )
    const link = screen.getByRole("link", { name: /ext/ })
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(screen.getByText(/external link/)).toHaveClass("sr-only")
    expect(link.querySelector("svg")).not.toBeNull()
  })

  test("TextLink_weightNormal_appliesFontNormal", () => {
    renderTextLink(<TextLink to="/news" weight="normal">news</TextLink>)
    const link = screen.getByRole("link", { name: /news/ })
    expect(link).toHaveClass("font-normal")
    expect(link).not.toHaveClass("font-semibold")
    expect(link).not.toHaveClass("font-bold")
  })

  test("TextLink_weightBold_appliesFontBold", () => {
    renderTextLink(<TextLink to="/news" weight="bold">news</TextLink>)
    const link = screen.getByRole("link", { name: /news/ })
    expect(link).toHaveClass("font-bold")
    expect(link).not.toHaveClass("font-normal")
  })

  test("TextLink_weightDefault_appliesFontSemibold", () => {
    renderTextLink(<TextLink to="/news">news</TextLink>)
    const link = screen.getByRole("link", { name: /news/ })
    expect(link).toHaveClass("font-semibold")
  })

})
