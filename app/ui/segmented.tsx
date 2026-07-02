import { useRef } from "react"

import { cn } from "./cn"

type SegmentedOption = { value: string; label: string }

type SegmentedProps = {
  ariaLabel: string
  options: readonly SegmentedOption[]
  value: string
  onChange: (value: string) => void
  size?: "sm" | "md"
  // Lay the segments on an equal-width grid instead of letting each shrink to its
  // own label (so "DSL" and "Graph" share one width).
  equalWidth?: boolean
}

// A joined two-or-more-segment toggle (AND/OR 等)。プルダウンではなく即時に値が
// 見える切替が要るときに使う。 排他選択なので radiogroup + roving tabindex を
// 採用し、 矢印 / Home / End の focus 移動が同時に選択も変える (activation
// follows focus)。
export const Segmented = (
  { ariaLabel, options, value, onChange, size = "sm", equalWidth = false }: SegmentedProps,
) => {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const focusAndSelect = (index: number) => {
    const opt = options[index]
    if (opt === undefined) return
    refs.current[index]?.focus()
    onChange(opt.value)
  }
  const handleKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1
    if (last < 0) return
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

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      {...(equalWidth
        ? { style: { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } }
        : {})}
      className={cn(
        "rounded-button border border-border-strong overflow-hidden select-none",
        equalWidth ? "inline-grid" : "inline-flex",
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value

        return (
          <button
            key={option.value}
            ref={(el) => { refs.current[index] = el }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={handleKeyDown(index)}
            className={cn(
              "font-bold leading-none cursor-pointer transition-colors",
              equalWidth && "text-center",
              size === "sm" ? "px-3 py-1 text-fs-label" : "px-3.5 py-1.5 text-fs-body-sm",
              index > 0 && "border-l border-border-strong",
              active ? "bg-brand text-white" : "bg-surface text-ink-mid hover:bg-surface-subtle",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
