import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { DateFacet } from "~/ui/date-facet"

// DateFacet の label 系 props は required (primitive は i18n 非依存)。 test は
// production の日本語 UI を再現する default を混ぜて呼び出す。
const DEFAULTS = {
  label: "公開日",
  clearLabel: "解除",
  presetLabels: { all: "すべて", "1y": "1年", "5y": "5年", "10y": "10年" },
  specifyLabel: "日付を指定",
  fromLabel: "FROM",
  toLabel: "TO",
  fromAriaLabel: "開始日",
  toAriaLabel: "終了日",
} as const

describe("DateFacet", () => {
  test("DateFacet_activeRange_setsAriaCheckedTrue", () => {
    render(<DateFacet {...DEFAULTS} active="5y" />)
    expect(screen.getByRole("radio", { name: "5年" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "1年" })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("radio", { name: "すべて" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "10年" })).toBeInTheDocument()
  })

  test("DateFacet_activeRange_appliesBrandSoftPalette", () => {
    render(<DateFacet {...DEFAULTS} active="1y" />)
    const active = screen.getByRole("radio", { name: "1年" })
    expect(active).toHaveClass("bg-brand-soft")
    expect(active).toHaveClass("text-brand-deep")
    expect(active).toHaveClass("border-brand/35")
  })

  test("DateFacet_inactiveRange_appliesNeutralPalette", () => {
    render(<DateFacet {...DEFAULTS} active="1y" />)
    const inactive = screen.getByRole("radio", { name: "5年" })
    expect(inactive).toHaveClass("bg-transparent")
    expect(inactive).toHaveClass("text-ink-mid")
    expect(inactive).toHaveClass("border-border-soft")
  })

  test("DateFacet_onRangeChange_invokedWithKey", () => {
    const onRangeChange = vi.fn()
    render(<DateFacet {...DEFAULTS} onRangeChange={onRangeChange} />)
    fireEvent.click(screen.getByRole("radio", { name: "5年" }))
    expect(onRangeChange).toHaveBeenCalledWith("5y")
  })

  test("DateFacet_fromTo_renderInputsWithValues", () => {
    render(<DateFacet {...DEFAULTS} from="2020-01-01" to="2024-12-31" />)
    const fromInput = screen.getByLabelText("開始日") as HTMLInputElement
    const toInput = screen.getByLabelText("終了日") as HTMLInputElement
    expect(fromInput.value).toBe("2020-01-01")
    expect(toInput.value).toBe("2024-12-31")
  })

  test("DateFacet_onFromChange_invokedWithValue", () => {
    const onFromChange = vi.fn()
    render(<DateFacet {...DEFAULTS} onFromChange={onFromChange} />)
    fireEvent.change(screen.getByLabelText("開始日"), { target: { value: "2024-01-01" } })
    expect(onFromChange).toHaveBeenCalledWith("2024-01-01")
  })

  test("DateFacet_customLabel_rendersGroupLabel", () => {
    render(<DateFacet {...DEFAULTS} label="公開期間" />)
    expect(screen.getByText("公開期間")).toBeInTheDocument()
  })

  test("DateFacet_appliedCountWithOnClear_rendersClearButton", () => {
    const onClear = vi.fn()
    render(<DateFacet {...DEFAULTS} appliedCount={1} onClear={onClear} />)
    fireEvent.click(screen.getByRole("button", { name: "解除" }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  test("DateFacet_appliedCountZero_doesNotRenderClearButton", () => {
    render(<DateFacet {...DEFAULTS} appliedCount={0} onClear={() => undefined} />)
    expect(screen.queryByRole("button", { name: "解除" })).toBeNull()
  })

  test("DateFacet_onToChange_invokedWithValue", () => {
    const onToChange = vi.fn()
    render(<DateFacet {...DEFAULTS} onToChange={onToChange} />)
    fireEvent.change(screen.getByLabelText("終了日"), { target: { value: "2025-12-31" } })
    expect(onToChange).toHaveBeenCalledWith("2025-12-31")
  })

  test("DateFacet_activeAll_setsAllAriaCheckedTrue", () => {
    render(<DateFacet {...DEFAULTS} active="all" />)
    expect(screen.getByRole("radio", { name: "すべて" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "1年" })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("radio", { name: "5年" })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("radio", { name: "10年" })).toHaveAttribute("aria-checked", "false")
  })

  test("DateFacet_active10y_setsOnly10yAriaCheckedTrue", () => {
    render(<DateFacet {...DEFAULTS} active="10y" />)
    expect(screen.getByRole("radio", { name: "10年" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "すべて" })).toHaveAttribute("aria-checked", "false")
  })

  test("DateFacet_onRangeChangeAll_invokedWithAll", () => {
    const onRangeChange = vi.fn()
    render(<DateFacet {...DEFAULTS} active="1y" onRangeChange={onRangeChange} />)
    fireEvent.click(screen.getByRole("radio", { name: "すべて" }))
    expect(onRangeChange).toHaveBeenCalledWith("all")
  })

  test("DateFacet_onRangeChange10y_invokedWith10y", () => {
    const onRangeChange = vi.fn()
    render(<DateFacet {...DEFAULTS} onRangeChange={onRangeChange} />)
    fireEvent.click(screen.getByRole("radio", { name: "10年" }))
    expect(onRangeChange).toHaveBeenCalledWith("10y")
  })

  test("DateFacet_activeCustom_checksNoPreset", () => {
    render(<DateFacet {...DEFAULTS} active="custom" from="2020-01-01" to="2020-12-31" />)
    for (const name of ["すべて", "1年", "5年", "10年"]) {
      expect(screen.getByRole("radio", { name })).toHaveAttribute("aria-checked", "false")
    }
  })
})
