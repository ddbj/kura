import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, test, vi } from "vitest"

import { Combobox, type ComboboxOption } from "~/ui/combobox"

const OPTS: ComboboxOption[] = [
  { value: "WGS", label: "WGS", count: 100 },
  { value: "AMPLICON", label: "AMPLICON", count: 50 },
  { value: "RNA-Seq", label: "RNA-Seq", count: 25 },
]

const Harness = ({
  options = OPTS,
  initial = "",
}: {
  options?: ComboboxOption[]
  initial?: string
}) => {
  const [value, setValue] = useState(initial)

  return <Combobox ariaLabel="value" options={options} value={value} onChange={setValue} />
}

describe("Combobox", () => {
  test("Combobox_default_rendersTextboxComboboxWithAriaLabel", () => {
    render(<Combobox ariaLabel="value" options={OPTS} value="" onChange={vi.fn()} />)
    const input = screen.getByRole("combobox", { name: "value" })
    expect(input.tagName).toBe("INPUT")
    expect(input).toHaveAttribute("aria-autocomplete", "list")
    expect(input).toHaveAttribute("aria-expanded", "false")
  })

  test("Combobox_default_doesNotMarkAsInvalid", () => {
    render(<Combobox ariaLabel="value" options={OPTS} value="" onChange={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "value" })).not.toHaveAttribute("aria-invalid")
  })

  test("Combobox_stateWarn_marksAsInvalid", () => {
    render(<Combobox ariaLabel="value" options={OPTS} value="x" onChange={vi.fn()} state="warn" />)
    expect(screen.getByRole("combobox", { name: "value" })).toHaveAttribute("aria-invalid", "true")
  })

  test("Combobox_ariaDescribedby_isApplied", () => {
    render(
      <Combobox ariaLabel="value" options={OPTS} value="" onChange={vi.fn()} ariaDescribedby="h" />,
    )
    expect(screen.getByRole("combobox", { name: "value" })).toHaveAttribute("aria-describedby", "h")
  })

  test("Combobox_closed_doesNotRenderListbox", () => {
    render(<Combobox ariaLabel="value" options={OPTS} value="" onChange={vi.fn()} />)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("Combobox_mouseDown_opensListboxWithAllOptions", () => {
    render(<Harness />)
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "value" }))
    expect(screen.getByRole("listbox", { name: "value" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /WGS/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /AMPLICON/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /RNA-Seq/ })).toBeInTheDocument()
  })

  test("Combobox_optionShowsCount", () => {
    render(<Harness />)
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "value" }))
    // Count is rendered alongside the label (en-US grouping).
    expect(screen.getByRole("option", { name: /WGS/ })).toHaveTextContent("100")
  })

  test("Combobox_typing_filtersOptionsByLabel", () => {
    render(<Harness />)
    const input = screen.getByRole("combobox", { name: "value" })
    fireEvent.change(input, { target: { value: "rna" } })
    // Case-insensitive substring match keeps only RNA-Seq.
    expect(screen.getByRole("option", { name: /RNA-Seq/ })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /WGS/ })).toBeNull()
    expect(screen.queryByRole("option", { name: /AMPLICON/ })).toBeNull()
  })

  test("Combobox_typing_emitsRawValueEvenWhenNoCandidateMatches", () => {
    const onChange = vi.fn()
    render(<Combobox ariaLabel="value" options={OPTS} value="" onChange={onChange} />)
    fireEvent.change(screen.getByRole("combobox", { name: "value" }), {
      target: { value: "custom-free-text" },
    })
    // The field is free-entry: a typed value is committed verbatim, not snapped
    // to a candidate.
    expect(onChange).toHaveBeenCalledWith("custom-free-text")
  })

  test("Combobox_noMatch_showsEmptyLabelButKeepsTypedValue", () => {
    // Typing a string that matches no candidate filters the list to empty; the
    // emptyLabel shows while the typed value is still committed (free entry).
    const Empty = () => {
      const [value, setValue] = useState("")

      return (
        <Combobox
          ariaLabel="value"
          options={OPTS}
          value={value}
          onChange={setValue}
          emptyLabel="該当なし"
        />
      )
    }
    render(<Empty />)
    const input = screen.getByRole("combobox", { name: "value" })
    fireEvent.change(input, { target: { value: "zzz" } })
    expect(screen.getByText("該当なし")).toBeInTheDocument()
    expect(screen.queryByRole("option")).toBeNull()
    expect(input).toHaveValue("zzz")
  })

  test("Combobox_optionClick_commitsOptionValueAndCloses", () => {
    const onChange = vi.fn()
    render(<Combobox ariaLabel="value" options={OPTS} value="" onChange={onChange} />)
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "value" }))
    fireEvent.click(screen.getByRole("option", { name: /AMPLICON/ }))
    expect(onChange).toHaveBeenCalledWith("AMPLICON")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("Combobox_optionCommitsValueNotLabel", () => {
    // organism-style: label differs from the committed value (taxID).
    const onChange = vi.fn()
    render(
      <Combobox
        ariaLabel="organism"
        options={[{ value: "9606", label: "Homo sapiens (9606)" }]}
        value=""
        onChange={onChange}
      />,
    )
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "organism" }))
    fireEvent.click(screen.getByRole("option", { name: "Homo sapiens (9606)" }))
    expect(onChange).toHaveBeenCalledWith("9606")
  })

  test("Combobox_arrowDownEnter_selectsHighlightedOption", () => {
    const onChange = vi.fn()
    render(<Combobox ariaLabel="value" options={OPTS} value="" onChange={onChange} />)
    const input = screen.getByRole("combobox", { name: "value" })
    fireEvent.mouseDown(input)
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith("AMPLICON")
  })

  test("Combobox_arrowDownFromClosed_opensListbox", () => {
    render(<Harness />)
    const input = screen.getByRole("combobox", { name: "value" })
    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(screen.getByRole("listbox", { name: "value" })).toBeInTheDocument()
  })

  test("Combobox_escape_closesListbox", () => {
    render(<Harness />)
    const input = screen.getByRole("combobox", { name: "value" })
    fireEvent.mouseDown(input)
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("Combobox_outsideMouseDown_closesListbox", () => {
    render(
      <div>
        <Harness />
        <button data-testid="outside">outside</button>
      </div>,
    )
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "value" }))
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    act(() => {
      fireEvent.mouseDown(screen.getByTestId("outside"))
    })
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("Combobox_disabled_doesNotOpen", () => {
    render(<Combobox ariaLabel="value" options={OPTS} value="" onChange={vi.fn()} disabled />)
    const input = screen.getByRole("combobox", { name: "value" })
    expect(input).toBeDisabled()
    fireEvent.mouseDown(input)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("Combobox_enterWithNoHighlight_keepsTypedValueAndCloses", () => {
    const onChange = vi.fn()
    render(
      <Combobox ariaLabel="value" options={[]} value="free" onChange={onChange} emptyLabel="none" />,
    )
    const input = screen.getByRole("combobox", { name: "value" })
    fireEvent.mouseDown(input)
    fireEvent.keyDown(input, { key: "Enter" })
    // No candidate to adopt → Enter just closes without overwriting the value.
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("Combobox_width_appliesInlineStyleToWrapper", () => {
    const { container } = render(
      <Combobox ariaLabel="value" options={OPTS} value="" onChange={vi.fn()} width={232} />,
    )
    const wrapper = container.firstElementChild as HTMLElement | null
    expect(wrapper?.style.width).toBe("232px")
  })

  test("Combobox_ariaControls_matchesListboxWhenOpen", () => {
    render(<Harness />)
    const input = screen.getByRole("combobox", { name: "value" })
    expect(input).not.toHaveAttribute("aria-controls")
    fireEvent.mouseDown(input)
    const controls = input.getAttribute("aria-controls")
    expect(controls).not.toBeNull()
    expect(screen.getByRole("listbox")).toHaveAttribute("id", controls ?? "")
  })
})
