import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { FmtRadio } from "~/ui/fmt-radio"

const findLabel = (text: string) => {
  const span = screen.getByText(text)
  const label = span.closest("label")
  if (label === null) throw new Error("label ancestor not found")
  return label
}

describe("FmtRadio", () => {
  test("FmtRadio_default_rendersRadioInputWithName", () => {
    render(<FmtRadio name="lib" label="pair-end" />)
    expect(screen.getByRole("radio", { name: "pair-end" })).toHaveAttribute("name", "lib")
  })

  test("FmtRadio_default_appliesBaseCardTokens", () => {
    render(<FmtRadio name="lib" label="pair-end" />)
    const label = findLabel("pair-end")
    expect(label).toHaveClass("rounded-button")
    expect(label).toHaveClass("text-fs-body-sm")
    expect(label).toHaveClass("leading-snug")
  })

  test("FmtRadio_unchecked_appliesSurfacePalette", () => {
    render(<FmtRadio name="lib" label="single-end" />)
    const label = findLabel("single-end")
    expect(label).toHaveClass("bg-surface")
    expect(label).toHaveClass("border-border-soft")
  })

  test("FmtRadio_defaultCheckedTrue_appliesBrandSofterPalette", () => {
    render(<FmtRadio name="lib" label="pair-end" defaultChecked />)
    const label = findLabel("pair-end")
    expect(label).toHaveClass("bg-brand-softer")
    expect(label).toHaveClass("border-brand-light/50")
  })

  test("FmtRadio_defaultCheckedTrue_appliesSemiboldFont", () => {
    render(<FmtRadio name="lib" label="pair-end" defaultChecked />)
    expect(screen.getByText("pair-end")).toHaveClass("font-semibold")
  })

  test("FmtRadio_unchecked_appliesMediumFont", () => {
    render(<FmtRadio name="lib" label="pair-end" />)
    expect(screen.getByText("pair-end")).toHaveClass("font-medium")
  })

  test("FmtRadio_sub_rendersSubTextWithMicroSize", () => {
    render(<FmtRadio name="lib" label="x" sub="補足" />)
    const sub = screen.getByText("補足")
    expect(sub).toHaveClass("text-fs-micro")
  })

  test("FmtRadio_subChecked_appliesBrandDeepText", () => {
    render(<FmtRadio name="lib" label="x" sub="補足" defaultChecked />)
    expect(screen.getByText("補足")).toHaveClass("text-brand-deep")
  })

  test("FmtRadio_subUnchecked_appliesInkMidText", () => {
    render(<FmtRadio name="lib" label="x" sub="補足" />)
    expect(screen.getByText("補足")).toHaveClass("text-ink-mid")
  })

  test("FmtRadio_onChange_invokedOnClick", () => {
    const onChange = vi.fn()
    render(<FmtRadio name="lib" label="x" onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio"))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
