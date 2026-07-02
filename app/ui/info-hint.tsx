import { useEffect, useId, useRef, useState } from "react"

import { cn } from "./cn"
import { InfoIcon } from "./icons"

type InfoHintProps = {
  label: string
  ariaLabel?: string
}

// An ⓘ trigger that reveals a real tooltip bubble. It shows on hover and on
// keyboard focus, and a click "pins" it open (for touch / deliberate reading);
// an outside click or Escape unpins. Native `title` is unreliable (slow, no
// touch, no styling), so this drives its own bubble.
export const InfoHint = ({ label, ariaLabel }: InfoHintProps) => {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const wrapperRef = useRef<HTMLSpanElement | null>(null)
  const tooltipId = useId()
  const open = hovered || pinned

  useEffect(() => {
    if (!pinned) return
    const onPointerDown = (event: MouseEvent | TouchEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setPinned(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setPinned(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("touchstart", onPointerDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("touchstart", onPointerDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [pinned])

  return (
    <span ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={ariaLabel ?? label}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => setPinned((p) => !p)}
        className={cn(
          "inline-flex items-center justify-center rounded-pill cursor-help leading-none",
          open ? "text-brand" : "text-ink-soft hover:text-brand",
        )}
      >
        <InfoIcon size={14} />
      </button>
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute z-tooltip left-1/2 -translate-x-1/2 top-[calc(100%+6px)] w-max max-w-[260px] px-2.5 py-1.5 rounded-button bg-ink text-white text-fs-label leading-snug shadow-card-hover whitespace-normal"
        >
          {label}
        </span>
      )}
    </span>
  )
}
