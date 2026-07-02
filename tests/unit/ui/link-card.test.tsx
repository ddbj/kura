import { render, screen } from "@testing-library/react"
import { createRoutesStub } from "react-router"
import { describe, expect, test } from "vitest"

import { LinkCard } from "~/ui/link-card"

const baseClasses = [
  "block",
  "bg-surface",
  "border",
  "border-border-soft",
  "rounded-card",
  "text-ink",
  "no-underline",
  "hover:shadow-card-hover",
  "transition-shadow",
] as const

const renderLinkCard = (node: React.ReactNode) => {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <>{node}</> },
    { path: "/services/dra", Component: () => <span>dra</span> },
  ])
  return render(<Stub />)
}

describe("LinkCard", () => {
  test("LinkCard_internal_rendersRouterLinkWithHref", () => {
    renderLinkCard(<LinkCard to="/services/dra">dra-card</LinkCard>)
    const link = screen.getByRole("link", { name: "dra-card" })
    expect(link).toHaveAttribute("href", "/services/dra")
    expect(link).not.toHaveAttribute("target")
    expect(link).not.toHaveAttribute("rel")
  })

  test("LinkCard_internal_appliesBaseClass", () => {
    renderLinkCard(<LinkCard to="/services/dra">dra-card</LinkCard>)
    const link = screen.getByRole("link", { name: "dra-card" })
    expect(link).toHaveClass(...baseClasses)
  })

  test("LinkCard_external_setsTargetAndRel", () => {
    render(
      <LinkCard external href="https://example.com" externalSrLabel="opens in new tab">
        ext-card
      </LinkCard>,
    )
    const link = screen.getByRole("link", { name: /ext-card/ })
    expect(link).toHaveAttribute("href", "https://example.com")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  test("LinkCard_external_appliesBaseClass", () => {
    render(
      <LinkCard external href="https://example.com" externalSrLabel="opens in new tab">
        ext-card
      </LinkCard>,
    )
    expect(screen.getByRole("link", { name: /ext-card/ })).toHaveClass(...baseClasses)
  })

  test("LinkCard_external_appendsSrOnlyLabel", () => {
    render(
      <LinkCard external href="https://example.com" externalSrLabel="opens in new tab">
        ext-card
      </LinkCard>,
    )
    // sr-only span が accessible name の末尾に付く (inline 連結の空白有無は
    // accname 実装依存なので緩くマッチする)。
    expect(screen.getByRole("link", { name: /ext-card\s?opens in new tab/ })).toBeInTheDocument()
  })

  test("LinkCard_children_areRendered", () => {
    renderLinkCard(
      <LinkCard to="/services/dra">
        <span data-testid="inner">nested</span>
      </LinkCard>,
    )
    expect(screen.getByTestId("inner")).toHaveTextContent("nested")
  })
})
