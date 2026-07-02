import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { Select, TextInput } from "~/ui"

// The query builder relies on Select and TextInput resolving to the same height
// at a given size so the controls line up (no short-select / tall-input mismatch).
describe("form control sizing", () => {
  test("selectAndTextInput_shareHeightAtSameSize", () => {
    render(
      <>
        <Select size="md" ariaLabel="size-select" options={["a"]} defaultValue="a" />
        <TextInput size="md" ariaLabel="size-input" />
      </>,
    )
    expect(screen.getByRole("combobox", { name: "size-select" }).className).toContain("h-8")
    expect(screen.getByRole("textbox", { name: "size-input" }).className).toContain("h-8")
  })

  test("unsizedControls_keepLegacyPadding", () => {
    render(
      <>
        <Select ariaLabel="legacy-select" options={["a"]} defaultValue="a" />
        <TextInput ariaLabel="legacy-input" />
      </>,
    )
    expect(screen.getByRole("combobox", { name: "legacy-select" }).className).toContain("py-1.5")
    expect(screen.getByRole("textbox", { name: "legacy-input" }).className).toContain("py-2")
  })
})
