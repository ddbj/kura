import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { TextArea } from "~/ui/text-area"

describe("TextArea", () => {
  test("TextArea_default_doesNotMarkAsInvalid", () => {
    render(<TextArea ariaLabel="body" />)
    expect(screen.getByRole("textbox", { name: "body" })).not.toHaveAttribute("aria-invalid")
  })

  test("TextArea_stateWarn_marksAsInvalid", () => {
    render(<TextArea ariaLabel="body" state="warn" />)
    expect(screen.getByRole("textbox", { name: "body" })).toHaveAttribute("aria-invalid", "true")
  })

  test("TextArea_ariaDescribedby_isApplied", () => {
    render(<TextArea ariaLabel="body" ariaDescribedby="body-hint" />)
    expect(screen.getByRole("textbox", { name: "body" }))
      .toHaveAttribute("aria-describedby", "body-hint")
  })

  test("TextArea_defaultRows_isThree", () => {
    render(<TextArea ariaLabel="body" />)
    expect(screen.getByRole("textbox", { name: "body" })).toHaveAttribute("rows", "3")
  })

  test("TextArea_overrideRows_isApplied", () => {
    render(<TextArea ariaLabel="body" rows={8} />)
    expect(screen.getByRole("textbox", { name: "body" })).toHaveAttribute("rows", "8")
  })
})
