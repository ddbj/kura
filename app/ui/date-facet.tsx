import { useEffect, useRef, useState } from "react"

import { cn } from "./cn"
import { FacetGroup } from "./facet-group"
import { ChevronDownIcon } from "./icons"
import { Label } from "./label"

// "custom" = a manually entered FROM/TO range that matches no preset; it
// highlights none of the preset buttons but still drives the date filter.
export type DateRangeKey = "all" | "1y" | "5y" | "10y" | "custom"

// Preset buttons render in this order; "custom" has no button (it highlights none).
type PresetKey = Exclude<DateRangeKey, "custom">

type PresetLabels = Record<PresetKey, string>

// label / preset labels / clear / specify / from / to は全て required (primitive
// は i18n 非依存)。 caller が t() 済み string を渡す。
type DateFacetProps = {
  label: string
  active?: DateRangeKey
  appliedCount?: number
  onClear?: () => void
  clearLabel: string
  onRangeChange?: (key: DateRangeKey) => void
  from?: string
  to?: string
  onFromChange?: (value: string) => void
  onToChange?: (value: string) => void
  presetLabels: PresetLabels
  specifyLabel: string
  fromLabel: string
  toLabel: string
  fromAriaLabel: string
  toAriaLabel: string
}

const PRESET_ORDER: readonly PresetKey[] = ["all", "1y", "5y", "10y"]

const dateInputClass =
  "mt-1 w-full px-2.5 py-1.5 text-fs-body-sm border border-border-soft rounded-button text-ink-mid font-mono box-border"

export const DateFacet = ({
  label,
  active = "all",
  appliedCount = 0,
  onClear,
  clearLabel,
  onRangeChange,
  from,
  to,
  onFromChange,
  onToChange,
  presetLabels,
  specifyLabel,
  fromLabel,
  toLabel,
  fromAriaLabel,
  toAriaLabel,
}: DateFacetProps) => {
  // Reveal the FROM/TO detail whenever a preset is picked or a custom range is
  // set, so the resulting window is visible immediately; collapse follows "all".
  const [open, setOpen] = useState(active !== "all")
  useEffect(() => {
    setOpen(active !== "all")
  }, [active])

  // 排他選択の preset を radiogroup + roving tabindex で表現。 activation follows
  // focus で矢印キー移動が同時に選択も変える。 "custom" は preset には含めず、
  // active が custom のときは radiogroup 内で選択された radio が無い状態になる。
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const focusAndSelect = (index: number) => {
    const key = PRESET_ORDER[index]
    if (key === undefined) return
    refs.current[index]?.focus()
    onRangeChange?.(key)
  }
  const handleKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const last = PRESET_ORDER.length - 1
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault()
      focusAndSelect(index === 0 ? last : index - 1)
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault()
      focusAndSelect(index === last ? 0 : index + 1)
    } else if (e.key === "Home") {
      e.preventDefault()
      focusAndSelect(0)
    } else if (e.key === "End") {
      e.preventDefault()
      focusAndSelect(last)
    }
  }
  // active が "custom" (プリセットに一致しない範囲) のときは先頭に tabindex=0 を
  // 与え、 Tab で radiogroup に入れるようにする。
  const activePresetIndex = PRESET_ORDER.indexOf(active as PresetKey)
  const focusableIndex = activePresetIndex === -1 ? 0 : activePresetIndex

  return (
    <FacetGroup
      label={label}
      appliedCount={appliedCount}
      clearLabel={clearLabel}
      {...(onClear === undefined ? {} : { onClear })}
    >
      <li className="list-none p-0 m-0 block">
        <div role="radiogroup" aria-label={label} className="flex gap-1">
          {PRESET_ORDER.map((key, index) => {
            const on = key === active
            return (
              <button
                key={key}
                ref={(el) => { refs.current[index] = el }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={index === focusableIndex ? 0 : -1}
                onClick={() => onRangeChange?.(key)}
                onKeyDown={handleKeyDown(index)}
                className={cn(
                  "flex-1 py-1 text-fs-label font-semibold rounded-button cursor-pointer font-sans border",
                  on
                    ? "bg-brand-soft text-brand-deep border-brand/35"
                    : "bg-transparent text-ink-mid border-border-soft",
                )}
              >
                {presetLabels[key]}
              </button>
            )
          })}
        </div>
        <details
          className="mt-2"
          open={open}
          onToggle={(e) => setOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer list-none text-fs-micro text-ink-mid font-semibold inline-flex items-center gap-1 py-0.5">
            <ChevronDownIcon size={9} />
            {specifyLabel}
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            <div>
              <Label as="div">{fromLabel}</Label>
              <input
                type="date"
                value={from ?? ""}
                onChange={(e) => onFromChange?.(e.target.value)}
                aria-label={fromAriaLabel}
                className={dateInputClass}
              />
            </div>
            <div>
              <Label as="div">{toLabel}</Label>
              <input
                type="date"
                value={to ?? ""}
                onChange={(e) => onToChange?.(e.target.value)}
                aria-label={toAriaLabel}
                className={dateInputClass}
              />
            </div>
          </div>
        </details>
      </li>
    </FacetGroup>
  )
}
