import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { FormGroup } from "~/ui/form-group"
import { TextInput } from "~/ui/text-input"

describe("FormGroup", () => {
  test("FormGroup_wrapsChildrenInFieldset", () => {
    const { container } = render(
      <FormGroup num="1." label="ライブラリ構造">
        <TextInput ariaLabel="value" />
      </FormGroup>,
    )
    const fieldset = container.querySelector("fieldset")
    expect(fieldset).not.toBeNull()
    expect(fieldset?.querySelector("legend")).not.toBeNull()
  })

  test("FormGroup_legendContainsNumAndLabel", () => {
    render(
      <FormGroup num="2." label="オプション">
        <input aria-label="x" />
      </FormGroup>,
    )
    expect(screen.getByText("2.")).toBeInTheDocument()
    expect(screen.getByText("オプション")).toBeInTheDocument()
  })

  test("FormGroup_optionalTrue_rendersOptionalTag", () => {
    render(
      <FormGroup num="3." label="任意項目" optional optionalLabel="任意">
        <input aria-label="x" />
      </FormGroup>,
    )
    expect(screen.getByText("任意")).toBeInTheDocument()
  })

  test("FormGroup_hintWithId_setsAriaDescribedbyAndHintId", () => {
    const { container } = render(
      <FormGroup num="4." label="メタ" hint="必須項目" hintId="meta-hint">
        <input aria-label="x" />
      </FormGroup>,
    )
    const fieldset = container.querySelector("fieldset")
    expect(fieldset).toHaveAttribute("aria-describedby", "meta-hint")
    expect(screen.getByText("必須項目")).toHaveAttribute("id", "meta-hint")
  })

  test("FormGroup_hintWithoutId_doesNotSetAriaDescribedby", () => {
    const { container } = render(
      <FormGroup num="5." label="メタ" hint="補足">
        <input aria-label="x" />
      </FormGroup>,
    )
    expect(container.querySelector("fieldset")).not.toHaveAttribute("aria-describedby")
  })
})
