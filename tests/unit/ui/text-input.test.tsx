import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { TextInput } from "~/ui/text-input"

describe("TextInput", () => {
  test("TextInput_default_doesNotMarkAsInvalid", () => {
    render(<TextInput ariaLabel="email" />)
    const input = screen.getByRole("textbox", { name: "email" })
    expect(input).not.toHaveAttribute("aria-invalid")
  })

  test("TextInput_stateWarn_marksAsInvalid", () => {
    render(<TextInput ariaLabel="email" state="warn" />)
    const input = screen.getByRole("textbox", { name: "email" })
    expect(input).toHaveAttribute("aria-invalid", "true")
  })

  test("TextInput_ariaDescribedby_isApplied", () => {
    render(<TextInput ariaLabel="email" ariaDescribedby="hint-1" />)
    const input = screen.getByRole("textbox", { name: "email" })
    expect(input).toHaveAttribute("aria-describedby", "hint-1")
  })

  test("TextInput_mono_addsFontMonoClass", () => {
    render(<TextInput ariaLabel="dsl" mono />)
    const input = screen.getByRole("textbox", { name: "dsl" })
    expect(input).toHaveClass("font-mono")
  })

  test("TextInput_typeNotSpecified_defaultsToText", () => {
    render(<TextInput ariaLabel="x" />)
    expect(screen.getByRole("textbox", { name: "x" })).toHaveAttribute("type", "text")
  })

  test("TextInput_emptyValue_rendersInput", () => {
    render(<TextInput ariaLabel="empty" value="" readOnly />)
    expect(screen.getByRole("textbox", { name: "empty" })).toHaveValue("")
  })

  test("TextInput_warnAndMono_appliesBothBorderAndMonoFont", () => {
    render(<TextInput ariaLabel="dsl-warn" state="warn" mono />)
    const input = screen.getByRole("textbox", { name: "dsl-warn" })
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input).toHaveClass("font-mono")
    expect(input).toHaveClass("border-warn-border")
    expect(input).toHaveClass("bg-warn-bg")
  })

  test("TextInput_default_appliesNeutralBorderPalette", () => {
    render(<TextInput ariaLabel="x" />)
    const input = screen.getByRole("textbox", { name: "x" })
    expect(input).toHaveClass("border-border-soft")
    expect(input).toHaveClass("bg-surface")
    expect(input).not.toHaveClass("border-warn-border")
  })
})
