import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, test, vi } from "vitest"

import { Select } from "~/ui/select"

describe("Select", () => {
  test("Select_default_rendersComboboxWithAriaLabel", () => {
    render(<Select ariaLabel="sort" options={["a", "b"]} />)
    const trigger = screen.getByRole("combobox", { name: "sort" })
    expect(trigger.tagName).toBe("BUTTON")
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox")
    expect(trigger).toHaveAttribute("aria-expanded", "false")
  })

  test("Select_default_doesNotMarkAsInvalid", () => {
    render(<Select ariaLabel="sort" options={["a", "b"]} />)
    expect(screen.getByRole("combobox", { name: "sort" })).not.toHaveAttribute("aria-invalid")
  })

  test("Select_stateWarn_marksAsInvalid", () => {
    render(<Select ariaLabel="sort" options={["a", "b"]} state="warn" />)
    expect(screen.getByRole("combobox", { name: "sort" }))
      .toHaveAttribute("aria-invalid", "true")
  })

  test("Select_ariaDescribedby_isApplied", () => {
    render(<Select ariaLabel="sort" options={["a"]} ariaDescribedby="sort-hint" />)
    expect(screen.getByRole("combobox", { name: "sort" }))
      .toHaveAttribute("aria-describedby", "sort-hint")
  })

  test("Select_default_appliesNeutralBorderAndSurface", () => {
    render(<Select ariaLabel="x" options={["a", "b"]} />)
    const trigger = screen.getByRole("combobox", { name: "x" })
    expect(trigger).toHaveClass("border-border-soft", "bg-surface")
    expect(trigger).not.toHaveClass("border-warn-border")
  })

  test("Select_stateWarn_appliesWarnBorderAndBg", () => {
    render(<Select ariaLabel="x" options={["", "a"]} defaultValue="" state="warn" />)
    const trigger = screen.getByRole("combobox", { name: "x" })
    expect(trigger).toHaveClass("border-warn-border", "bg-warn-bg")
  })

  test("Select_warnEmptyValue_appliesSoftPlaceholderColor", () => {
    render(<Select ariaLabel="x" options={["", "a"]} defaultValue="" state="warn" />)
    expect(screen.getByRole("combobox", { name: "x" })).toHaveClass("text-ink-soft")
  })

  test("Select_warnNonEmptyValue_doesNotApplySoftColor", () => {
    render(<Select ariaLabel="x" options={["", "Alpha"]} defaultValue="Alpha" state="warn" />)
    expect(screen.getByRole("combobox", { name: "x" })).not.toHaveClass("text-ink-soft")
  })

  test("Select_closed_doesNotRenderListbox", () => {
    render(<Select ariaLabel="x" options={["a", "b"]} />)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("Select_click_opensListboxAndSetsExpandedTrue", () => {
    render(<Select ariaLabel="x" options={["a", "b"]} />)
    fireEvent.click(screen.getByRole("combobox", { name: "x" }))
    expect(screen.getByRole("listbox", { name: "x" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "x" }))
      .toHaveAttribute("aria-expanded", "true")
  })

  test("Select_stringOptions_renderAllOptionsWhenOpen", () => {
    render(<Select ariaLabel="x" options={["alpha", "beta"]} />)
    fireEvent.click(screen.getByRole("combobox", { name: "x" }))
    expect(screen.getByRole("option", { name: "alpha" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "beta" })).toBeInTheDocument()
  })

  test("Select_objectOptions_renderLabelAsAccessibleName", () => {
    render(
      <Select
        ariaLabel="x"
        options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]}
      />,
    )
    fireEvent.click(screen.getByRole("combobox", { name: "x" }))
    expect(screen.getByRole("option", { name: "Alpha" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Beta" })).toBeInTheDocument()
  })

  test("Select_currentValueOption_isAriaSelected", () => {
    render(<Select ariaLabel="x" options={["a", "b"]} defaultValue="b" />)
    fireEvent.click(screen.getByRole("combobox", { name: "x" }))
    expect(screen.getByRole("option", { name: "a" })).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("option", { name: "b" })).toHaveAttribute("aria-selected", "true")
  })

  test("Select_triggerLabel_reflectsSelectedOptionLabel", () => {
    render(
      <Select
        ariaLabel="x"
        options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]}
        defaultValue="b"
      />,
    )
    expect(screen.getByRole("combobox", { name: "x" })).toHaveTextContent("Beta")
  })

  test("Select_optionClick_callsOnChangeAndClosesListbox", () => {
    const onChange = vi.fn()
    render(<Select ariaLabel="x" options={["a", "b"]} defaultValue="a" onChange={onChange} />)
    fireEvent.click(screen.getByRole("combobox", { name: "x" }))
    fireEvent.click(screen.getByRole("option", { name: "b" }))
    expect(onChange).toHaveBeenCalledWith("b")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("Select_uncontrolled_optionClick_updatesTriggerLabel", () => {
    render(<Select ariaLabel="x" options={["a", "b"]} defaultValue="a" />)
    const trigger = screen.getByRole("combobox", { name: "x" })
    expect(trigger).toHaveTextContent("a")
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("option", { name: "b" }))
    expect(trigger).toHaveTextContent("b")
  })

  test("Select_controlled_optionClick_doesNotChangeWithoutParentUpdate", () => {
    const onChange = vi.fn()
    render(<Select ariaLabel="x" options={["a", "b"]} value="a" onChange={onChange} />)
    const trigger = screen.getByRole("combobox", { name: "x" })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("option", { name: "b" }))
    expect(onChange).toHaveBeenCalledWith("b")
    expect(trigger).toHaveTextContent("a")
  })

  test("Select_controlledValueUpdate_reflectsParentChange", () => {
    const Harness = () => {
      const [v, setV] = useState("a")
      return (
        <div>
          <Select ariaLabel="x" options={["a", "b"]} value={v} />
          <button onClick={() => setV("b")}>swap</button>
        </div>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole("combobox", { name: "x" })
    expect(trigger).toHaveTextContent("a")
    fireEvent.click(screen.getByRole("button", { name: "swap" }))
    expect(trigger).toHaveTextContent("b")
  })

  test("Select_arrowDown_opensListboxFromClosed", () => {
    render(<Select ariaLabel="x" options={["a", "b"]} defaultValue="a" />)
    const trigger = screen.getByRole("combobox", { name: "x" })
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    expect(screen.getByRole("listbox", { name: "x" })).toBeInTheDocument()
  })

  test("Select_arrowDown_advancesActiveDescendant", () => {
    render(<Select ariaLabel="x" options={["a", "b", "c"]} defaultValue="a" />)
    const trigger = screen.getByRole("combobox", { name: "x" })
    fireEvent.click(trigger)
    const firstActive = trigger.getAttribute("aria-activedescendant")
    expect(firstActive).not.toBeNull()
    expect(screen.getByRole("option", { name: "a" }).id).toBe(firstActive)
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    expect(screen.getByRole("option", { name: "b" }).id)
      .toBe(trigger.getAttribute("aria-activedescendant"))
  })

  test("Select_arrowUpFromFirst_wrapsToLast", () => {
    render(<Select ariaLabel="x" options={["a", "b", "c"]} defaultValue="a" />)
    const trigger = screen.getByRole("combobox", { name: "x" })
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: "ArrowUp" })
    expect(screen.getByRole("option", { name: "c" }).id)
      .toBe(trigger.getAttribute("aria-activedescendant"))
  })

  test("Select_homeEnd_jumpToFirstAndLast", () => {
    render(<Select ariaLabel="x" options={["a", "b", "c"]} defaultValue="b" />)
    const trigger = screen.getByRole("combobox", { name: "x" })
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: "End" })
    expect(screen.getByRole("option", { name: "c" }).id)
      .toBe(trigger.getAttribute("aria-activedescendant"))
    fireEvent.keyDown(trigger, { key: "Home" })
    expect(screen.getByRole("option", { name: "a" }).id)
      .toBe(trigger.getAttribute("aria-activedescendant"))
  })

  test("Select_enterOnOpen_selectsActiveOption", () => {
    const onChange = vi.fn()
    render(
      <Select ariaLabel="x" options={["a", "b", "c"]} defaultValue="a" onChange={onChange} />,
    )
    const trigger = screen.getByRole("combobox", { name: "x" })
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    fireEvent.keyDown(trigger, { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith("b")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("Select_spaceOnOpen_selectsActiveOption", () => {
    const onChange = vi.fn()
    render(
      <Select ariaLabel="x" options={["a", "b"]} defaultValue="a" onChange={onChange} />,
    )
    const trigger = screen.getByRole("combobox", { name: "x" })
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    fireEvent.keyDown(trigger, { key: " " })
    expect(onChange).toHaveBeenCalledWith("b")
  })

  test("Select_escape_closesListboxWithoutCommit", () => {
    const onChange = vi.fn()
    render(
      <Select ariaLabel="x" options={["a", "b"]} defaultValue="a" onChange={onChange} />,
    )
    const trigger = screen.getByRole("combobox", { name: "x" })
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    fireEvent.keyDown(trigger, { key: "Escape" })
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  test("Select_outsideMouseDown_closesListbox", () => {
    render(
      <div>
        <Select ariaLabel="x" options={["a", "b"]} />
        <button data-testid="outside">outside</button>
      </div>,
    )
    fireEvent.click(screen.getByRole("combobox", { name: "x" }))
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    act(() => {
      fireEvent.mouseDown(screen.getByTestId("outside"))
    })
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("Select_triggerReClick_closesListbox", () => {
    render(<Select ariaLabel="x" options={["a", "b"]} />)
    const trigger = screen.getByRole("combobox", { name: "x" })
    fireEvent.click(trigger)
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("Select_disabled_doesNotOpenOnClick", () => {
    render(<Select ariaLabel="x" options={["a", "b"]} disabled />)
    const trigger = screen.getByRole("combobox", { name: "x" })
    expect(trigger).toBeDisabled()
    fireEvent.click(trigger)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("Select_width_appliesInlineStyleToWrapper", () => {
    const { container } = render(<Select ariaLabel="x" options={["a"]} width={200} />)
    const wrapper = container.firstElementChild as HTMLElement | null
    expect(wrapper?.style.width).toBe("200px")
  })

  test("Select_aria_controls_matchesListboxIdWhenOpen", () => {
    render(<Select ariaLabel="x" options={["a", "b"]} />)
    const trigger = screen.getByRole("combobox", { name: "x" })
    expect(trigger).not.toHaveAttribute("aria-controls")
    fireEvent.click(trigger)
    const controls = trigger.getAttribute("aria-controls")
    expect(controls).not.toBeNull()
    expect(screen.getByRole("listbox")).toHaveAttribute("id", controls ?? "")
  })

  test("Select_id_isAppliedToTrigger", () => {
    render(<Select ariaLabel="x" options={["a"]} id="my-select" />)
    expect(screen.getByRole("combobox", { name: "x" })).toHaveAttribute("id", "my-select")
  })
})
