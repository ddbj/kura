import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { FacetRow } from "~/ui/facet-row"

const renderRow = (node: React.ReactNode) => render(<ul>{node}</ul>)

describe("FacetRow", () => {
  test("FacetRow_defaultType_rendersCheckbox", () => {
    renderRow(<FacetRow label="Homo sapiens" />)
    expect(screen.getByRole("checkbox", { name: /Homo sapiens/ })).toBeInTheDocument()
  })

  test("FacetRow_typeRadio_rendersRadio", () => {
    renderRow(<FacetRow type="radio" name="species" label="Homo sapiens" />)
    expect(screen.getByRole("radio", { name: /Homo sapiens/ })).toBeInTheDocument()
  })

  test("FacetRow_defaultCheckedTrue_isChecked", () => {
    renderRow(<FacetRow label="x" defaultChecked />)
    expect(screen.getByRole("checkbox")).toBeChecked()
  })

  test("FacetRow_count_rendersCountWithMonoLabelToken", () => {
    renderRow(<FacetRow label="x" count={1234} />)
    const count = screen.getByText("1234")
    expect(count).toHaveClass("font-mono")
    expect(count).toHaveClass("text-fs-label")
    expect(count).toHaveClass("text-ink-soft")
  })

  test("FacetRow_swatch_rendersSwatch8pxSquareWithBackgroundStyle", () => {
    const { container } = renderRow(
      <FacetRow label="DDBJ" swatch="var(--color-src-ddbj)" />,
    )
    const swatch = container.querySelector("span[aria-hidden]")
    expect(swatch).not.toBeNull()
    expect(swatch).toHaveStyle({ background: "var(--color-src-ddbj)" })
    expect(swatch).toHaveClass("w-2")
    expect(swatch).toHaveClass("h-2")
    expect(swatch).toHaveClass("rounded-pill")
  })

  test("FacetRow_noSwatch_doesNotRenderSwatchSpan", () => {
    const { container } = renderRow(<FacetRow label="x" />)
    expect(container.querySelector("span[aria-hidden]")).toBeNull()
  })

  test("FacetRow_monoTrue_appliesMonoLabelToken", () => {
    renderRow(<FacetRow label="WGS" mono />)
    const text = screen.getByText("WGS")
    expect(text).toHaveClass("font-mono")
    expect(text).toHaveClass("text-fs-label")
  })

  test("FacetRow_monoFalse_appliesSansBodySmToken", () => {
    renderRow(<FacetRow label="Homo sapiens" />)
    const text = screen.getByText("Homo sapiens")
    expect(text).toHaveClass("font-sans")
    expect(text).toHaveClass("text-fs-body-sm")
  })

  test("FacetRow_checked_appliesSemiboldFont", () => {
    renderRow(<FacetRow label="checked label" defaultChecked />)
    expect(screen.getByText("checked label")).toHaveClass("font-semibold")
  })

  test("FacetRow_unchecked_appliesNormalFont", () => {
    renderRow(<FacetRow label="unchecked label" />)
    expect(screen.getByText("unchecked label")).toHaveClass("font-normal")
  })

  test("FacetRow_compact_appliesCompactPadding", () => {
    renderRow(<FacetRow label="x" compact />)
    const li = screen.getByRole("listitem")
    expect(li).toHaveClass("py-0.5")
    expect(li).not.toHaveClass("py-1")
  })

  test("FacetRow_sub_rendersSubText", () => {
    renderRow(<FacetRow label="x" sub="補足" />)
    const sub = screen.getByText("補足")
    expect(sub).toHaveClass("font-mono")
    expect(sub).toHaveClass("text-fs-micro")
    expect(sub).toHaveClass("text-ink-soft")
  })

  test("FacetRow_onChange_invokedOnInputChange", () => {
    const onChange = vi.fn()
    renderRow(<FacetRow label="x" onChange={onChange} />)
    fireEvent.click(screen.getByRole("checkbox"))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
