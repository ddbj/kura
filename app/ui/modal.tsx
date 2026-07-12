import { type ReactNode, useEffect, useRef } from "react"
import { createPortal } from "react-dom"

import { cn } from "./cn"

type Props = {
  open: boolean
  onClose: () => void
  labelledBy?: string
  className?: string
  children: ReactNode
}

// Portal + Esc-to-close + focus trap + click-outside dismisses.
export const Modal = ({ open, onClose, labelledBy, className, children }: Props) => {
  const modalRef = useRef<HTMLDivElement>(null)
  const previousActive = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousActive.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])",
    )
    focusable?.[0]?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()

        return
      }
      if (event.key !== "Tab") return
      const focus = modalRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])",
      )
      if (focus === undefined || focus.length === 0) return
      const first = focus[0]
      const last = focus[focus.length - 1]
      if (first === undefined || last === undefined) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)

    return () => {
      document.removeEventListener("keydown", onKey)
      previousActive.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null
  if (typeof document === "undefined") return null

  return createPortal(
    <div
      className="scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn("modal", className)}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
