import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { Button } from "~/ui/button"

describe("Button", () => {
  test("Button_defaults_typeIsButton", () => {
    render(<Button>送信</Button>)
    const button = screen.getByRole("button", { name: "送信" })
    expect(button).toHaveAttribute("type", "button")
  })

  test("Button_disabled_setsAriaAndAttribute", () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>無効</Button>)
    const button = screen.getByRole("button", { name: "無効" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-disabled", "true")
  })

  test("Button_disabled_doesNotInvokeOnClick", () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>無効</Button>)
    fireEvent.click(screen.getByRole("button", { name: "無効" }))
    expect(onClick).not.toHaveBeenCalled()
  })

  test("Button_typeSubmit_isApplied", () => {
    render(<Button type="submit">submit</Button>)
    expect(screen.getByRole("button", { name: "submit" })).toHaveAttribute("type", "submit")
  })

  test("Button_onClick_isInvoked", () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>click</Button>)
    fireEvent.click(screen.getByRole("button", { name: "click" }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
