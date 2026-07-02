import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { FacetGroup } from "~/ui/facet-group"

describe("FacetGroup", () => {
  test("FacetGroup_default_rendersGroupLabel", () => {
    render(
      <FacetGroup label="生物種">
        <li>row</li>
      </FacetGroup>,
    )
    expect(screen.getByText("生物種")).toBeInTheDocument()
  })

  test("FacetGroup_children_renderedInsideList", () => {
    render(
      <FacetGroup label="生物種">
        <li>Homo sapiens</li>
      </FacetGroup>,
    )
    const item = screen.getByText("Homo sapiens")
    expect(item.tagName).toBe("LI")
  })

  test("FacetGroup_appliedCountZero_doesNotRenderClearButton", () => {
    render(
      <FacetGroup label="x" appliedCount={0} onClear={() => undefined}>
        <li>row</li>
      </FacetGroup>,
    )
    expect(screen.queryByRole("button", { name: "解除" })).toBeNull()
  })

  test("FacetGroup_appliedCountPositiveWithOnClear_rendersClearButton", () => {
    const onClear = vi.fn()
    render(
      <FacetGroup label="x" appliedCount={1} onClear={onClear}>
        <li>row</li>
      </FacetGroup>,
    )
    const button = screen.getByRole("button", { name: "解除" })
    fireEvent.click(button)
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  test("FacetGroup_appliedCountPositiveWithoutOnClear_doesNotRenderClearButton", () => {
    render(
      <FacetGroup label="x" appliedCount={1}>
        <li>row</li>
      </FacetGroup>,
    )
    expect(screen.queryByRole("button", { name: "解除" })).toBeNull()
  })

  test("FacetGroup_showMoreTrue_rendersShowMoreButtonAndInvokes", () => {
    const onShowMore = vi.fn()
    render(
      <FacetGroup label="x" showMore onShowMore={onShowMore}>
        <li>row</li>
      </FacetGroup>,
    )
    const button = screen.getByRole("button", { name: "さらに表示" })
    fireEvent.click(button)
    expect(onShowMore).toHaveBeenCalledTimes(1)
  })

  test("FacetGroup_showMoreFalse_doesNotRenderShowMoreButton", () => {
    render(
      <FacetGroup label="x">
        <li>row</li>
      </FacetGroup>,
    )
    expect(screen.queryByRole("button", { name: /さらに表示/ })).toBeNull()
  })

  test("FacetGroup_customShowMoreLabel_overridesDefault", () => {
    render(
      <FacetGroup label="x" showMore showMoreLabel="他を見る">
        <li>row</li>
      </FacetGroup>,
    )
    expect(screen.getByRole("button", { name: "他を見る" })).toBeInTheDocument()
  })
})
