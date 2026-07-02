import { render } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { Section } from "~/ui/section"

const findSection = (container: HTMLElement) => {
  const section = container.querySelector("section")
  if (section === null) throw new Error("section not found")
  return section
}

const findInner = (container: HTMLElement) => {
  const inner = findSection(container).querySelector(":scope > div")
  if (inner === null) throw new Error("inner wrapper not found")
  return inner
}

describe("Section", () => {
  test("Section_rendersSectionWithInnerWrapperAroundChildren", () => {
    const { container } = render(<Section>content</Section>)
    const inner = findInner(container)
    expect(inner.textContent).toBe("content")
  })

  test("Section_maxWidth_appliesInlineMaxWidthOnInner", () => {
    const { container } = render(<Section maxWidth={820}>x</Section>)
    expect(findInner(container)).toHaveStyle({ maxWidth: "820px" })
  })

  test("Section_noMaxWidth_hasNoInlineStyleOnInner", () => {
    const { container } = render(<Section>x</Section>)
    expect(findInner(container)).not.toHaveAttribute("style")
  })
})
