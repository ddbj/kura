import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { Label } from "~/ui/label"

describe("Label", () => {
  test("Label_default_rendersAsSpan", () => {
    const { container } = render(<Label>WHERE</Label>)
    expect(container.querySelector("span")?.textContent).toBe("WHERE")
    expect(container.querySelector("div")).toBeNull()
  })

  test("Label_asDiv_rendersAsDiv", () => {
    const { container } = render(<Label as="div">WHERE</Label>)
    expect(container.querySelector("div")?.textContent).toBe("WHERE")
    expect(container.querySelector("span")).toBeNull()
  })

  test("Label_color_appliesInlineColor", () => {
    render(<Label color="#A56712">WHERE</Label>)
    expect(screen.getByText("WHERE")).toHaveStyle({ color: "#A56712" })
  })

  test("Label_size_appliesInlineFontSize", () => {
    render(<Label size={14}>WHERE</Label>)
    expect(screen.getByText("WHERE")).toHaveStyle({ fontSize: "14px" })
  })

  test("Label_noStyleProps_hasNoInlineStyle", () => {
    render(<Label>WHERE</Label>)
    expect(screen.getByText("WHERE")).not.toHaveAttribute("style")
  })
})
