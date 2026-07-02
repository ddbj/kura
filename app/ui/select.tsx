import type { CSSProperties, KeyboardEvent } from "react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { cn } from "./cn"
import { ChevronDownIcon } from "./icons"

type SelectState = "default" | "warn"

type SelectSize = "sm" | "md" | "lg"

export type SelectOption = string | { value: string; label: string }

type NormalizedOption = { value: string; label: string }

type SelectProps = {
  ariaLabel: string
  ariaDescribedby?: string
  options: readonly SelectOption[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  width?: number
  size?: SelectSize
  state?: SelectState
  disabled?: boolean
  id?: string
}

// Fixed heights so a sized Select lines up exactly with a sized TextInput; the
// unsized default keeps the original compact padding for existing call sites.
const sizeClass: Record<SelectSize, string> = {
  sm: "h-7 text-fs-body-sm",
  md: "h-8 text-fs-body",
  lg: "h-9 text-fs-body",
}

const normalize = (option: SelectOption): NormalizedOption =>
  typeof option === "string" ? { value: option, label: option } : option

// The open menu renders in a body portal with fixed positioning so it escapes
// the clipping / scroll of any overflow ancestor (e.g. a table card).
type MenuPosition = { top: number; left: number; width: number }

export const Select = ({
  ariaLabel,
  ariaDescribedby,
  options,
  value,
  defaultValue,
  onChange,
  width,
  size,
  state = "default",
  disabled = false,
  id,
}: SelectProps) => {
  const isControlled = value !== undefined
  const [internalValue, setInternalValue] = useState<string>(defaultValue ?? "")
  const currentValue = isControlled ? value : internalValue

  const normalizedOptions = useMemo(() => options.map(normalize), [options])

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number>(() => {
    const idx = normalizedOptions.findIndex((opt) => opt.value === currentValue)
    return idx >= 0 ? idx : 0
  })
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const listboxId = useId()
  const optionIdBase = useId()

  const isWarn = state === "warn"
  const isEmpty = currentValue === ""
  const selectedOption = normalizedOptions.find((opt) => opt.value === currentValue)
  const triggerLabel = selectedOption?.label ?? ""

  const closeAndFocus = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const commit = (next: string): void => {
    if (!isControlled) setInternalValue(next)
    onChange?.(next)
  }

  const openWithActive = (): void => {
    const idx = normalizedOptions.findIndex((opt) => opt.value === currentValue)
    setActiveIndex(idx >= 0 ? idx : 0)
    setOpen(true)
  }

  const handleToggle = (): void => {
    if (disabled) return
    if (open) {
      setOpen(false)
    } else {
      openWithActive()
    }
  }

  const handleSelect = (next: string): void => {
    commit(next)
    closeAndFocus()
  }

  const handleKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return
    const optionCount = normalizedOptions.length
    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (open) {
        // optionCount===0 で modulo すると NaN になり aria-activedescendant が
        // `<id>-NaN` を露出する (Combobox と同様に length>0 ガードで防ぐ)。
        if (optionCount > 0) setActiveIndex((i) => (i + 1) % optionCount)
      } else {
        openWithActive()
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      if (open) {
        if (optionCount > 0) setActiveIndex((i) => (i - 1 + optionCount) % optionCount)
      } else {
        openWithActive()
      }
    } else if (e.key === "Home" && open) {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === "End" && open) {
      e.preventDefault()
      setActiveIndex(normalizedOptions.length - 1)
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      if (open) {
        const target = normalizedOptions[activeIndex]
        if (target !== undefined) handleSelect(target.value)
      } else {
        openWithActive()
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === "Tab" && open) {
      setOpen(false)
    }
  }

  // Track the trigger rect while open so the portal menu follows it through
  // scroll / resize instead of being clipped by an overflow ancestor.
  useEffect(() => {
    if (!open) {
      setMenuPosition(null)
      return
    }
    const measure = (): void => {
      const trigger = triggerRef.current
      if (trigger === null) return
      const rect = trigger.getBoundingClientRect()
      setMenuPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    measure()
    window.addEventListener("scroll", measure, true)
    window.addEventListener("resize", measure)
    return () => {
      window.removeEventListener("scroll", measure, true)
      window.removeEventListener("resize", measure)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent | TouchEvent): void => {
      const target = e.target as Node
      const insideTrigger = wrapperRef.current?.contains(target) ?? false
      const insideMenu = menuRef.current?.contains(target) ?? false
      if (!insideTrigger && !insideMenu) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("touchstart", onPointerDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("touchstart", onPointerDown)
    }
  }, [open])

  const wrapperStyle: CSSProperties = { width: width ?? "auto" }

  const menu = open && menuPosition !== null && typeof document !== "undefined"
    ? createPortal(
      <ul
        ref={menuRef}
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
        style={{
          position: "fixed",
          top: menuPosition.top,
          left: menuPosition.left,
          minWidth: menuPosition.width,
        }}
        className="z-popover bg-surface border border-border-soft rounded-card shadow-card-hover py-1 max-h-popover overflow-auto"
      >
        {normalizedOptions.map((opt, idx) => {
          const selected = opt.value === currentValue
          const active = idx === activeIndex
          return (
            <li key={opt.value} role="presentation">
              <button
                type="button"
                id={`${optionIdBase}-${idx}`}
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => handleSelect(opt.value)}
                className={cn(
                  "w-full text-left px-3 py-2 text-fs-body cursor-pointer",
                  active ? "bg-surface-subtle" : "",
                  selected ? "text-brand-deep font-bold" : "text-ink",
                )}
              >
                {opt.label}
              </button>
            </li>
          )
        })}
      </ul>,
      document.body,
    )
    : null

  return (
    <div ref={wrapperRef} className="relative inline-block" style={wrapperStyle}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedby}
        aria-invalid={isWarn || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && normalizedOptions.length > 0
          ? `${optionIdBase}-${activeIndex}`
          : undefined}
        disabled={disabled}
        onClick={handleToggle}
        onKeyDown={handleKey}
        className={cn(
          "w-full inline-flex items-center justify-between gap-2 leading-none pl-3 pr-2 rounded-button font-sans text-left cursor-pointer",
          size === undefined ? "py-1.5 text-fs-body" : sizeClass[size],
          isWarn
            ? "border border-warn-border bg-warn-bg"
            : "border border-border-soft bg-surface",
          isWarn && isEmpty ? "text-ink-soft" : "text-ink",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span className="flex-1 truncate">{triggerLabel}</span>
        <ChevronDownIcon size={14} className="text-ink-mid shrink-0" />
      </button>
      {menu}
    </div>
  )
}
