import { fireEvent, render, screen } from "@testing-library/react"
import { createRoutesStub } from "react-router"
import { describe, expect, test, vi } from "vitest"

import { Chip } from "~/ui/chip"

const renderChip = (node: React.ReactNode) => {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <>{node}</> },
    { path: "/search", Component: () => <span>search</span> },
  ])
  return render(<Stub />)
}

describe("Chip", () => {
  test("Chip_base_appliesPillAndLabelTokens", () => {
    renderChip(<Chip to="/search">cancer</Chip>)
    const link = screen.getByRole("link", { name: "cancer" })
    expect(link).toHaveClass("inline-flex")
    expect(link).toHaveClass("rounded-pill")
    expect(link).toHaveClass("px-3")
    expect(link).toHaveClass("py-1")
    expect(link).toHaveClass("text-fs-label")
    expect(link).toHaveClass("font-medium")
    expect(link).toHaveClass("border")
  })

  test("Chip_defaultLink_rendersAnchorWithHref", () => {
    renderChip(<Chip to="/search">cancer</Chip>)
    expect(screen.getByRole("link", { name: "cancer" })).toHaveAttribute("href", "/search")
  })

  test("Chip_asButton_rendersButtonElement", () => {
    renderChip(
      <Chip as="button" onClick={() => undefined}>クリック</Chip>,
    )
    expect(screen.getByRole("button", { name: "クリック" })).toHaveAttribute("type", "button")
  })

  test("Chip_asButton_onClickInvoked", () => {
    const onClick = vi.fn()
    renderChip(
      <Chip as="button" onClick={onClick}>click</Chip>,
    )
    fireEvent.click(screen.getByRole("button", { name: "click" }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test("Chip_filterSelected_appliesBrandSoftPalette", () => {
    renderChip(<Chip as="button" selected>WGS</Chip>)
    const button = screen.getByRole("button", { name: "WGS" })
    expect(button).toHaveClass("bg-brand-soft")
    expect(button).toHaveClass("text-brand-deep")
    expect(button).toHaveClass("border-brand/35")
  })

  test("Chip_filterUnselected_appliesNeutralPalette", () => {
    renderChip(<Chip as="button">WGS</Chip>)
    const button = screen.getByRole("button", { name: "WGS" })
    expect(button).toHaveClass("bg-surface-subtle")
    expect(button).toHaveClass("text-ink-mid")
    expect(button).toHaveClass("border-border-soft")
  })

  test("Chip_kindExampleSelected_doesNotApplyBrandPalette", () => {
    renderChip(<Chip kind="example" as="button" selected>example</Chip>)
    const button = screen.getByRole("button", { name: "example" })
    expect(button).toHaveClass("bg-surface-subtle")
    expect(button).not.toHaveClass("bg-brand-soft")
  })

  test("Chip_monoTrue_appliesFontMono", () => {
    renderChip(<Chip as="button" mono>AND</Chip>)
    expect(screen.getByRole("button", { name: "AND" })).toHaveClass("font-mono")
  })

  test("Chip_monoFalse_appliesFontSans", () => {
    renderChip(<Chip as="button">plain</Chip>)
    expect(screen.getByRole("button", { name: "plain" })).toHaveClass("font-sans")
  })
})
