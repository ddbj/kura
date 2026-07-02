import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { IconButton } from "~/ui/icon-button"

describe("IconButton", () => {
  test("IconButton_default_typeIsButton", () => {
    render(<IconButton ariaLabel="閉じる">×</IconButton>)
    expect(screen.getByRole("button", { name: "閉じる" })).toHaveAttribute("type", "button")
  })

  test("IconButton_default_appliesIconBaseTokens", () => {
    render(<IconButton ariaLabel="閉じる">×</IconButton>)
    const button = screen.getByRole("button", { name: "閉じる" })
    expect(button).toHaveClass("bg-transparent")
    expect(button).toHaveClass("border-0")
    expect(button).toHaveClass("text-ink-mid")
    expect(button).toHaveClass("rounded-button")
    expect(button).toHaveClass("inline-flex")
    expect(button).toHaveClass("items-center")
    expect(button).toHaveClass("justify-center")
  })

  test("IconButton_defaultSize_appliesInline26px", () => {
    render(<IconButton ariaLabel="閉じる">×</IconButton>)
    const button = screen.getByRole("button", { name: "閉じる" })
    expect(button).toHaveStyle({ width: "26px", height: "26px" })
  })

  test("IconButton_customSize_appliesInlineSize", () => {
    render(<IconButton ariaLabel="閉じる" size={44}>×</IconButton>)
    const button = screen.getByRole("button", { name: "閉じる" })
    expect(button).toHaveStyle({ width: "44px", height: "44px" })
  })

  test("IconButton_disabled_setsAriaAndDisabledAttribute", () => {
    render(<IconButton ariaLabel="閉じる" disabled>×</IconButton>)
    const button = screen.getByRole("button", { name: "閉じる" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-disabled", "true")
    expect(button).toHaveClass("cursor-not-allowed")
    expect(button).toHaveClass("opacity-55")
  })

  test("IconButton_disabled_doesNotInvokeOnClick", () => {
    const onClick = vi.fn()
    render(<IconButton ariaLabel="閉じる" disabled onClick={onClick}>×</IconButton>)
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }))
    expect(onClick).not.toHaveBeenCalled()
  })

  test("IconButton_onClick_isInvoked", () => {
    const onClick = vi.fn()
    render(<IconButton ariaLabel="閉じる" onClick={onClick}>×</IconButton>)
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
