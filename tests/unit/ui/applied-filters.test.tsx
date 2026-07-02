import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { AppliedFilters } from "~/ui/applied-filters"

describe("AppliedFilters", () => {
  test("AppliedFilters_emptyApplied_rendersNothing", () => {
    const { container } = render(<AppliedFilters applied={[]} />)
    expect(container.firstChild).toBeNull()
  })

  test("AppliedFilters_nonEmpty_rendersAppliedLabelWithCount", () => {
    render(
      <AppliedFilters
        applied={[
          { label: "種別", value: "ニュース" },
          { label: "ソース", value: "DDBJ" },
        ]}
      />,
    )
    expect(screen.getByText(/適用中 · 2/)).toBeInTheDocument()
  })

  test("AppliedFilters_appliedItems_renderAllLabelsAndValues", () => {
    render(
      <AppliedFilters
        applied={[
          { label: "種別", value: "ニュース" },
          { label: "ソース", value: "DDBJ" },
        ]}
      />,
    )
    expect(screen.getByText("種別")).toBeInTheDocument()
    expect(screen.getByText("ニュース")).toBeInTheDocument()
    expect(screen.getByText("ソース")).toBeInTheDocument()
    expect(screen.getByText("DDBJ")).toBeInTheDocument()
  })

  test("AppliedFilters_itemLabelChunk_appliesBrandSoftPalette", () => {
    render(
      <AppliedFilters applied={[{ label: "種別", value: "ニュース" }]} />,
    )
    const labelChunk = screen.getByText("種別")
    expect(labelChunk).toHaveClass("bg-brand-soft")
    expect(labelChunk).toHaveClass("text-brand-deep")
    expect(labelChunk).toHaveClass("font-semibold")
  })

  test("AppliedFilters_wrapper_appliesBottomBorderDivider", () => {
    const { container } = render(
      <AppliedFilters applied={[{ label: "x", value: "y" }]} />,
    )
    const wrapper = container.firstElementChild
    expect(wrapper).toHaveClass("border-b")
    expect(wrapper).toHaveClass("border-border-soft")
  })

  test("AppliedFilters_itemRow_appliesRoundedSurfaceBorder", () => {
    render(
      <AppliedFilters applied={[{ label: "x", value: "y" }]} />,
    )
    const row = screen.getByText("x").closest("li")
    expect(row).toHaveClass("rounded-button")
    expect(row).toHaveClass("border")
    expect(row).toHaveClass("border-border-soft")
    expect(row).toHaveClass("bg-surface")
  })

  test("AppliedFilters_onClearAll_renderClearAllButtonAndInvoke", () => {
    const onClearAll = vi.fn()
    render(
      <AppliedFilters
        applied={[{ label: "種別", value: "ニュース" }]}
        onClearAll={onClearAll}
      />,
    )
    const button = screen.getByRole("button", { name: "すべて解除" })
    fireEvent.click(button)
    expect(onClearAll).toHaveBeenCalledTimes(1)
  })

  test("AppliedFilters_customClearAllLabel_overridesDefault", () => {
    render(
      <AppliedFilters
        applied={[{ label: "x", value: "y" }]}
        onClearAll={() => undefined}
        clearAllLabel="クリア"
      />,
    )
    expect(screen.getByRole("button", { name: "クリア" })).toBeInTheDocument()
  })

  test("AppliedFilters_noOnClearAll_doesNotRenderClearAllButton", () => {
    render(<AppliedFilters applied={[{ label: "x", value: "y" }]} />)
    expect(screen.queryByRole("button", { name: "すべて解除" })).toBeNull()
  })

  test("AppliedFilters_perItemOnClear_renderRemoveButtonWithAccessibleName", () => {
    const onClear = vi.fn()
    render(
      <AppliedFilters
        applied={[{ label: "種別", value: "ニュース", onClear }]}
      />,
    )
    const button = screen.getByRole("button", { name: "種別: ニュース を解除" })
    fireEvent.click(button)
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  test("AppliedFilters_noPerItemOnClear_doesNotRenderRemoveButton", () => {
    render(<AppliedFilters applied={[{ label: "x", value: "y" }]} />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})
