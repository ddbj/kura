import type { ChangeEvent, CSSProperties, KeyboardEvent } from "react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { cn } from "./cn"
import { ChevronDownIcon } from "./icons"

type ComboboxState = "default" | "warn"

type ComboboxSize = "sm" | "md" | "lg"

// A candidate value. `label` is shown in the list (and the count, when present,
// right-aligned); `value` is what the field commits. label may differ from value
// (e.g. an organism shows the scientific name but commits the taxID).
export type ComboboxOption = { value: string; label: string; count?: number }

type ComboboxProps = {
  ariaLabel: string
  ariaDescribedby?: string
  options: readonly ComboboxOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  // Shown inside the open menu when the typed filter matches no option. The list
  // still accepts the typed value (the field is free-entry), so this is informational.
  emptyLabel?: string
  width?: number
  size?: ComboboxSize
  state?: ComboboxState
  disabled?: boolean
  mono?: boolean
  id?: string
}

const sizeClass: Record<ComboboxSize, string> = {
  sm: "h-7 text-fs-body-sm",
  md: "h-8 text-fs-body",
  lg: "h-9 text-fs-body",
}

// The open menu renders in a body portal with fixed positioning so it escapes
// the clipping / scroll of any overflow ancestor (mirrors Select).
type MenuPosition = { top: number; left: number; width: number }

// Editable, filterable single-value combobox: the user may type any value freely,
// and a dropdown surfaces matching candidates (filtered by the typed text once the
// user starts typing). Distinct from Select, which only picks from a fixed list.
export const Combobox = ({
  ariaLabel,
  ariaDescribedby,
  options,
  value,
  onChange,
  placeholder,
  emptyLabel,
  width,
  size = "md",
  state = "default",
  disabled = false,
  mono = false,
  id,
}: ComboboxProps) => {
  const [open, setOpen] = useState(false)
  // Filter the list by the typed text only after the user starts typing; opening
  // by click / arrow shows the full candidate list first.
  const [filtering, setFiltering] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const listboxId = useId()
  const optionIdBase = useId()

  const isWarn = state === "warn"

  const visibleOptions = useMemo(() => {
    if (!filtering || value === "") return options
    const needle = value.toLowerCase()

    return options.filter(
      (opt) => opt.label.toLowerCase().includes(needle) || opt.value.toLowerCase().includes(needle),
    )
  }, [options, filtering, value])

  const closeMenu = (): void => {
    setOpen(false)
    setFiltering(false)
  }

  const openMenu = (): void => {
    if (disabled) return
    setActiveIndex(0)
    setFiltering(false)
    setOpen(true)
  }

  const handleInput = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange(event.currentTarget.value)
    setFiltering(true)
    setActiveIndex(0)
    if (!open) setOpen(true)
  }

  const handleSelect = (next: string): void => {
    onChange(next)
    closeMenu()
    inputRef.current?.focus()
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (disabled) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (open) {
        if (visibleOptions.length > 0) setActiveIndex((i) => (i + 1) % visibleOptions.length)
      } else {
        openMenu()
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      if (open && visibleOptions.length > 0) {
        setActiveIndex((i) => (i - 1 + visibleOptions.length) % visibleOptions.length)
      }
    } else if (e.key === "Home" && open) {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === "End" && open) {
      e.preventDefault()
      setActiveIndex(visibleOptions.length - 1)
    } else if (e.key === "Enter") {
      if (open) {
        const target = visibleOptions[activeIndex]
        // Enter on a highlighted candidate adopts it; otherwise keep the typed value.
        if (target !== undefined) {
          e.preventDefault()
          handleSelect(target.value)
        } else {
          closeMenu()
        }
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault()
      closeMenu()
    } else if (e.key === "Tab" && open) {
      closeMenu()
    }
  }

  // Track the input rect while open so the portal menu follows it through scroll /
  // resize instead of being clipped by an overflow ancestor (mirrors Select).
  useEffect(() => {
    if (!open) {
      setMenuPosition(null)

      return
    }
    const measure = (): void => {
      const trigger = inputRef.current
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
      if (!insideTrigger && !insideMenu) closeMenu()
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
        {visibleOptions.length === 0
          ? (
            <li
              role="presentation"
              className="px-3 py-2 text-fs-body-sm text-ink-soft"
            >
              {emptyLabel ?? ""}
            </li>
          )
          : visibleOptions.map((opt, idx) => {
            const selected = opt.value === value
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
                  // Commit before the input's blur-driven close so the click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(opt.value)}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 text-left px-3 py-2 text-fs-body cursor-pointer",
                    active ? "bg-surface-subtle" : "",
                    selected ? "text-brand-deep font-bold" : "text-ink",
                  )}
                >
                  <span className="truncate">{opt.label}</span>
                  {opt.count !== undefined && (
                    <span className="shrink-0 text-fs-body-sm text-ink-soft tabular-nums">
                      {opt.count.toLocaleString("en-US")}
                    </span>
                  )}
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
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedby}
          aria-invalid={isWarn || undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && visibleOptions.length > 0
            ? `${optionIdBase}-${activeIndex}`
            : undefined}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          onChange={handleInput}
          onKeyDown={handleKey}
          onMouseDown={() => {
            if (!open) openMenu()
          }}
          className={cn(
            "w-full rounded-button border pl-3 pr-8 font-sans text-left",
            "focus:outline-none focus:ring-2 focus:ring-brand-light focus:border-brand",
            sizeClass[size],
            mono && "font-mono tracking-mono",
            isWarn ? "border-warn-border bg-warn-bg text-ink" : "border-border-soft bg-surface text-ink",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        />
        <ChevronDownIcon
          size={14}
          className="text-ink-mid shrink-0 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
        />
      </div>
      {menu}
    </div>
  )
}
