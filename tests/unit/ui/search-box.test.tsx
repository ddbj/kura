import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, test, vi } from "vitest"

import { SearchBox } from "~/ui/search-box"

// SearchBox の label 系 props は required (primitive は i18n 非依存)。 test は
// production の日本語 UI を再現する default を混ぜて呼び出す。
const DEFAULTS = {
  placeholder: "キーワード、accession、学名で検索",
  ariaLabel: "検索キーワード",
  submitLabel: "検索",
  scopeAriaLabel: "検索対象データベース",
} as const

describe("SearchBox", () => {
  test("SearchBox_defaults_rendersSearchRoleAndSubmitLabel", () => {
    render(<SearchBox {...DEFAULTS} />)
    expect(screen.getByRole("search")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "検索" })).toHaveAttribute("type", "submit")
  })

  test("SearchBox_defaults_inputHasDefaultPlaceholderAndAriaLabel", () => {
    render(<SearchBox {...DEFAULTS} />)
    const input = screen.getByRole("textbox", { name: "検索キーワード" })
    expect(input).toHaveAttribute("placeholder", "キーワード、accession、学名で検索")
    expect(input).toHaveAttribute("type", "text")
  })

  test("SearchBox_customLabels_areApplied", () => {
    render(<SearchBox {...DEFAULTS} ariaLabel="クエリ" submitLabel="探す" placeholder="入力..." />)
    expect(screen.getByRole("textbox", { name: "クエリ" }))
      .toHaveAttribute("placeholder", "入力...")
    expect(screen.getByRole("button", { name: "探す" })).toBeInTheDocument()
  })

  test("SearchBox_sizeMd_appliesPyAndFontTokens", () => {
    render(<SearchBox {...DEFAULTS} />)
    const input = screen.getByRole("textbox", { name: "検索キーワード" })
    expect(input).toHaveClass("py-2", "text-fs-body")
    const submit = screen.getByRole("button", { name: "検索" })
    expect(submit).toHaveClass("px-6", "text-fs-body")
  })

  test("SearchBox_sizeLg_appliesPyAndFontTokens", () => {
    render(<SearchBox {...DEFAULTS} size="lg" />)
    const input = screen.getByRole("textbox", { name: "検索キーワード" })
    expect(input).toHaveClass("py-3", "text-fs-body")
    const submit = screen.getByRole("button", { name: "検索" })
    expect(submit).toHaveClass("px-7", "text-fs-body")
  })

  test("SearchBox_sizeMdStaticScope_appliesScopePy15AndFsBodySm", () => {
    render(<SearchBox {...DEFAULTS} />)
    const scope = screen.getByLabelText(/検索対象データベース/)
    expect(scope).toHaveClass("py-1.5", "text-fs-body-sm")
  })

  test("SearchBox_sizeLgStaticScope_appliesScopePy3AndFsBodySm", () => {
    render(<SearchBox {...DEFAULTS} size="lg" />)
    const scope = screen.getByLabelText(/検索対象データベース/)
    expect(scope).toHaveClass("py-3", "text-fs-body-sm")
  })

  test("SearchBox_formClass_appliesBrandShellTokens", () => {
    render(<SearchBox {...DEFAULTS} />)
    const form = screen.getByRole("search")
    expect(form).toHaveClass(
      "bg-surface",
      "border",
      "border-border-strong",
      "rounded-card",
      "flex",
      "overflow-hidden",
      "shadow-card",
    )
  })

  test("SearchBox_toneAi_appliesBrandSoftBorder", () => {
    render(<SearchBox {...DEFAULTS} tone="ai" />)
    expect(screen.getByRole("search")).toHaveClass("bg-brand-soft", "border-brand")
  })

  test("SearchBox_invalid_appliesWarnBorderAndAriaInvalid", () => {
    render(<SearchBox {...DEFAULTS} invalid />)
    const form = screen.getByRole("search")
    expect(form).toHaveClass("bg-surface", "border-warn-border", "ring-warn-border")
    expect(form).not.toHaveClass("border-border-strong")
    expect(screen.getByRole("textbox", { name: "検索キーワード" }))
      .toHaveAttribute("aria-invalid", "true")
  })

  test("SearchBox_invalidWithAiTone_invalidWinsOverTone", () => {
    // An invalid state must override the AI tone so a generation failure reads
    // as a validation failure rather than staying in the AI-mode treatment.
    render(<SearchBox {...DEFAULTS} tone="ai" invalid />)
    const form = screen.getByRole("search")
    expect(form).toHaveClass("border-warn-border", "ring-warn-border")
    expect(form).not.toHaveClass("border-brand", "bg-brand-soft")
  })

  test("SearchBox_submitButton_appliesBrandPalette", () => {
    render(<SearchBox {...DEFAULTS} />)
    const submit = screen.getByRole("button", { name: "検索" })
    expect(submit).toHaveClass("bg-brand", "text-white", "hover:bg-brand-deep", "font-bold")
  })

  test("SearchBox_showSearchIconFalse_doesNotRenderSearchIcon", () => {
    const { container } = render(<SearchBox {...DEFAULTS} />)
    const inputRow = container.querySelector(".flex-1.flex.items-center")
    expect(inputRow).not.toBeNull()
    expect(inputRow?.querySelector("svg")).toBeNull()
  })

  test("SearchBox_showSearchIconTrue_rendersSearchIconInsideInputRow", () => {
    const { container } = render(<SearchBox {...DEFAULTS} showSearchIcon />)
    const inputRow = container.querySelector(".flex-1.flex.items-center")
    expect(inputRow?.querySelector("svg")).not.toBeNull()
  })

  test("SearchBox_showScopeFalse_doesNotRenderScope", () => {
    render(<SearchBox {...DEFAULTS} showScope={false} />)
    expect(screen.queryByLabelText(/検索対象データベース/)).toBeNull()
  })

  test("SearchBox_showScopeTrueNoOptions_rendersStaticScopeDiv", () => {
    render(<SearchBox {...DEFAULTS} />)
    const scope = screen.getByLabelText(/検索対象データベース/)
    expect(scope.tagName).toBe("DIV")
    expect(scope).not.toHaveAttribute("aria-haspopup")
  })

  test("SearchBox_interactiveScope_rendersButtonWithAriaHaspopup", () => {
    render(<SearchBox {...DEFAULTS} scopeOptions={["A", "B"]} />)
    const scope = screen.getByRole("button", { name: /検索対象データベース/ })
    expect(scope.tagName).toBe("BUTTON")
    expect(scope).toHaveAttribute("aria-haspopup", "listbox")
    expect(scope).toHaveAttribute("aria-expanded", "false")
  })

  test("SearchBox_interactiveScopeClosed_doesNotRenderListbox", () => {
    render(<SearchBox {...DEFAULTS} scopeOptions={["A", "B"]} />)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("SearchBox_interactiveScopeClick_opensListbox", () => {
    render(<SearchBox {...DEFAULTS} scopeOptions={["A", "B"]} />)
    fireEvent.click(screen.getByRole("button", { name: /検索対象データベース/ }))
    const listbox = screen.getByRole("listbox", { name: /検索対象データベース/ })
    expect(listbox).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /検索対象データベース/ }))
      .toHaveAttribute("aria-expanded", "true")
  })

  test("SearchBox_listboxOptions_renderWithRoleOption", () => {
    render(<SearchBox {...DEFAULTS} scope="A" scopeOptions={["A", "B"]} />)
    fireEvent.click(screen.getByRole("button", { name: /検索対象データベース/ }))
    const optA = screen.getByRole("option", { name: "A" })
    const optB = screen.getByRole("option", { name: "B" })
    expect(optA).toHaveAttribute("aria-selected", "true")
    expect(optB).toHaveAttribute("aria-selected", "false")
  })

  test("SearchBox_selectOption_callsOnScopeChangeAndClosesListbox", () => {
    const onScopeChange = vi.fn()
    render(
      <SearchBox {...DEFAULTS} scope="A" scopeOptions={["A", "B"]} onScopeChange={onScopeChange} />,
    )
    fireEvent.click(screen.getByRole("button", { name: /検索対象データベース/ }))
    fireEvent.click(screen.getByRole("option", { name: "B" }))
    expect(onScopeChange).toHaveBeenCalledWith("B")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("SearchBox_escKey_closesListbox", () => {
    render(<SearchBox {...DEFAULTS} scopeOptions={["A", "B"]} />)
    fireEvent.click(screen.getByRole("button", { name: /検索対象データベース/ }))
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" })
    })
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("SearchBox_outsideClick_closesListbox", () => {
    render(
      <div>
        <SearchBox {...DEFAULTS} scopeOptions={["A", "B"]} />
        <button data-testid="outside">outside</button>
      </div>,
    )
    fireEvent.click(screen.getByRole("button", { name: /検索対象データベース/ }))
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    act(() => {
      fireEvent.mouseDown(screen.getByTestId("outside"))
    })
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("SearchBox_scopeAriaLabel_overridesDefault", () => {
    render(<SearchBox {...DEFAULTS} scopeAriaLabel="DB scope" />)
    expect(screen.getByLabelText("DB scope")).toBeInTheDocument()
  })

  test("SearchBox_defaultValue_initializesQuery", () => {
    render(<SearchBox {...DEFAULTS} defaultValue="seed" />)
    expect(screen.getByRole("textbox", { name: "検索キーワード" })).toHaveValue("seed")
  })

  test("SearchBox_typingInput_updatesValueWithoutControlledProp", () => {
    render(<SearchBox {...DEFAULTS} />)
    const input = screen.getByRole("textbox", { name: "検索キーワード" })
    fireEvent.change(input, { target: { value: "cancer" } })
    expect(input).toHaveValue("cancer")
  })

  test("SearchBox_controlledValueEmpty_keepsInputEmpty", () => {
    render(<SearchBox {...DEFAULTS} value="" />)
    expect(screen.getByRole("textbox", { name: "検索キーワード" })).toHaveValue("")
  })

  test("SearchBox_controlledValueUpdate_reflectsParentChange", () => {
    const Harness = () => {
      const [value, setValue] = useState("first")
      return (
        <div>
          <SearchBox {...DEFAULTS} value={value} />
          <button onClick={() => setValue("second")}>swap</button>
        </div>
      )
    }
    render(<Harness />)
    const input = screen.getByRole("textbox", { name: "検索キーワード" })
    expect(input).toHaveValue("first")
    fireEvent.click(screen.getByRole("button", { name: "swap" }))
    expect(input).toHaveValue("second")
  })

  test("SearchBox_controlledToUncontrolled_keepsTypingAfterValueGoesUndefined", () => {
    const Harness = () => {
      const [value, setValue] = useState<string | undefined>("seeded")
      return (
        <div>
          <SearchBox {...DEFAULTS} value={value} />
          <button onClick={() => setValue(undefined)}>drop</button>
        </div>
      )
    }
    render(<Harness />)
    const input = screen.getByRole("textbox", { name: "検索キーワード" })
    expect(input).toHaveValue("seeded")
    fireEvent.click(screen.getByRole("button", { name: "drop" }))
    fireEvent.change(input, { target: { value: "typed" } })
    expect(input).toHaveValue("typed")
  })

  test("SearchBox_interactiveScopeReClick_closesListbox", () => {
    render(<SearchBox {...DEFAULTS} scopeOptions={["A", "B"]} />)
    const scope = screen.getByRole("button", { name: /検索対象データベース/ })
    fireEvent.click(scope)
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    fireEvent.click(scope)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  test("SearchBox_scopePropUpdate_reflectsParentChange", () => {
    const Harness = () => {
      const [scope, setScope] = useState("A")
      return (
        <div>
          <SearchBox {...DEFAULTS} scope={scope} />
          <button onClick={() => setScope("B")}>swap</button>
        </div>
      )
    }
    render(<Harness />)
    const scope = screen.getByLabelText(/検索対象データベース/)
    expect(scope).toHaveTextContent("A")
    fireEvent.click(screen.getByRole("button", { name: "swap" }))
    expect(scope).toHaveTextContent("B")
  })

  test("SearchBox_submit_invokesOnSubmitWithQueryAndScope", () => {
    const onSubmit = vi.fn()
    render(
      <SearchBox {...DEFAULTS} defaultValue="cancer" scope="A" onSubmit={onSubmit} />,
    )
    fireEvent.submit(screen.getByRole("search"))
    expect(onSubmit).toHaveBeenCalledWith("cancer", "A")
  })

  test("SearchBox_submitWithShowScopeFalse_passesUndefinedScope", () => {
    const onSubmit = vi.fn()
    render(
      <SearchBox {...DEFAULTS} defaultValue="cancer" scope="A" showScope={false} onSubmit={onSubmit} />,
    )
    fireEvent.submit(screen.getByRole("search"))
    expect(onSubmit).toHaveBeenCalledWith("cancer", undefined)
  })

  test("SearchBox_submitButtonClick_invokesOnSubmit", () => {
    const onSubmit = vi.fn()
    render(<SearchBox {...DEFAULTS} defaultValue="cancer" onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole("button", { name: "検索" }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  test("SearchBox_typing_invokesOnChangeWithValue", () => {
    const onChange = vi.fn()
    render(<SearchBox {...DEFAULTS} onChange={onChange} />)
    fireEvent.change(screen.getByRole("textbox", { name: "検索キーワード" }), {
      target: { value: "tumor" },
    })
    expect(onChange).toHaveBeenCalledWith("tumor")
  })

  test("SearchBox_maxWidth_appliesInlineStyle", () => {
    const { container } = render(<SearchBox {...DEFAULTS} maxWidth={820} />)
    const wrapper = container.firstElementChild as HTMLElement | null
    expect(wrapper).not.toBeNull()
    expect(wrapper?.style.maxWidth).toBe("820px")
  })

  test("SearchBox_defaultMaxWidth_appliesInlineStyle920px", () => {
    const { container } = render(<SearchBox {...DEFAULTS} />)
    const wrapper = container.firstElementChild as HTMLElement | null
    expect(wrapper?.style.maxWidth).toBe("920px")
  })

  test("SearchBox_listboxAriaControls_matchesListboxId", () => {
    render(<SearchBox {...DEFAULTS} scopeOptions={["A", "B"]} />)
    const scopeBtn = screen.getByRole("button", { name: /検索対象データベース/ })
    const listboxId = scopeBtn.getAttribute("aria-controls")
    expect(listboxId).not.toBeNull()
    fireEvent.click(scopeBtn)
    expect(screen.getByRole("listbox")).toHaveAttribute("id", listboxId ?? "")
  })
})
