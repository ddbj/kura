import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { FmtCheck } from "~/ui/fmt-check"

const findLabel = (text: string) => {
  const span = screen.getByText(text)
  const label = span.closest("label")
  if (label === null) throw new Error("label ancestor not found")
  return label
}

describe("FmtCheck", () => {
  test("FmtCheck_default_rendersCheckboxInput", () => {
    render(<FmtCheck label="hybrid assembly" />)
    expect(screen.getByRole("checkbox", { name: "hybrid assembly" })).toBeInTheDocument()
  })

  test("FmtCheck_defaultCheckedTrue_appliesBrandSofterPalette", () => {
    render(<FmtCheck label="hybrid assembly" defaultChecked />)
    const label = findLabel("hybrid assembly")
    expect(label).toHaveClass("bg-brand-softer")
    expect(label).toHaveClass("border-brand-light/50")
  })

  test("FmtCheck_unchecked_appliesSurfacePalette", () => {
    render(<FmtCheck label="raw signal" />)
    const label = findLabel("raw signal")
    expect(label).toHaveClass("bg-surface")
    expect(label).toHaveClass("border-border-soft")
  })

  test("FmtCheck_defaultCheckedTrue_appliesSemiboldFont", () => {
    render(<FmtCheck label="x" defaultChecked />)
    expect(screen.getByText("x")).toHaveClass("font-semibold")
  })

  test("FmtCheck_unchecked_appliesMediumFont", () => {
    render(<FmtCheck label="x" />)
    expect(screen.getByText("x")).toHaveClass("font-medium")
  })

  test("FmtCheck_sub_rendersSubTextWithMicroSize", () => {
    render(<FmtCheck label="x" sub="補足" />)
    expect(screen.getByText("補足")).toHaveClass("text-fs-micro")
  })

  test("FmtCheck_subChecked_appliesBrandDeepText", () => {
    render(<FmtCheck label="x" sub="補足" defaultChecked />)
    expect(screen.getByText("補足")).toHaveClass("text-brand-deep")
  })

  test("FmtCheck_subUnchecked_appliesInkMidText", () => {
    render(<FmtCheck label="x" sub="補足" />)
    expect(screen.getByText("補足")).toHaveClass("text-ink-mid")
  })

  test("FmtCheck_onChange_invokedOnClick", () => {
    const onChange = vi.fn()
    render(<FmtCheck label="x" onChange={onChange} />)
    fireEvent.click(screen.getByRole("checkbox"))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
