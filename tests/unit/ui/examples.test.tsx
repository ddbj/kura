import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { Examples } from "~/ui"

describe("Examples", () => {
  test("rendersLabelWithColonAndChips", () => {
    render(<Examples label="例" items={["cancer", "PRJDB*"]} onPick={() => undefined} />)
    expect(screen.getByText("例:")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "cancer" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "PRJDB*" })).toBeInTheDocument()
  })

  test("clickingChip_callsOnPickWithItem", () => {
    const onPick = vi.fn()
    render(<Examples label="例" items={["cancer", "tumor"]} onPick={onPick} />)
    fireEvent.click(screen.getByRole("button", { name: "tumor" }))
    expect(onPick).toHaveBeenCalledWith("tumor")
  })

  test("emptyItems_rendersNothing", () => {
    const { container } = render(<Examples label="例" items={[]} onPick={() => undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
