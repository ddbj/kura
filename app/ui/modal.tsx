import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from "react"
import { useEffect, useRef } from "react"

import { cn } from "./cn"
import { Heading } from "./heading"
import { IconButton } from "./icon-button"
import { CloseIcon } from "./icons"

type ModalProps = {
  open: boolean
  onClose: () => void
  width?: number
  ariaLabelledby: string
  ariaDescribedby?: string
  children: ReactNode
  closeOnOverlay?: boolean
  closeOnEscape?: boolean
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",")

const focusableWithin = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => {
      if (el.hasAttribute("disabled")) return false
      if (el.getAttribute("aria-hidden") === "true") return false
      // display:none / visibility:hidden は Tab で移れない = focusable でない。
      // querySelector の CSS selector では捕まえられないので computed style で
      // 弾く。
      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden") return false

      return true
    })

export const Modal = ({
  open,
  onClose,
  width = 820,
  ariaLabelledby,
  ariaDescribedby,
  children,
  closeOnOverlay = true,
  closeOnEscape = true,
}: ModalProps) => {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const previouslyFocused = useRef<Element | null>(null)
  const pointerDownOnOverlay = useRef<boolean>(false)

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement
    const root = dialogRef.current
    if (root) {
      const focusables = focusableWithin(root)
      ;(focusables[0] ?? root).focus()
    }

    const handleKey = (e: KeyboardEvent): void => {
      if (closeOnEscape && e.key === "Escape") {
        // portalled Combobox / Select 側で Esc を preventDefault 済みなら Modal
        // ごと閉じない (Combobox は自身の popup だけ閉じる)。
        if (e.defaultPrevented) return
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== "Tab" || !dialogRef.current) return
      const focusables = focusableWithin(dialogRef.current)
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (first === undefined || last === undefined) {
        e.preventDefault()
        return
      }
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      document.removeEventListener("keydown", handleKey)
      document.body.style.overflow = previousOverflow
      const prev = previouslyFocused.current
      if (prev instanceof HTMLElement) prev.focus()
    }
  }, [open, onClose, closeOnEscape])

  if (!open) return null

  const dialogStyle: CSSProperties = {
    width,
    maxWidth: "calc(100% - 64px)",
  }

  const overlayPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    pointerDownOnOverlay.current = e.target === e.currentTarget
  }
  const overlayClick = (e: MouseEvent<HTMLDivElement>): void => {
    if (!closeOnOverlay) return
    if (e.target === e.currentTarget && pointerDownOnOverlay.current) {
      onClose()
    }
    pointerDownOnOverlay.current = false
  }

  return (
    <div
      className="fixed inset-0 z-modal flex items-start justify-center pt-14 bg-ink/45"
      onPointerDown={overlayPointerDown}
      onClick={overlayClick}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        tabIndex={-1}
        style={dialogStyle}
        className="bg-surface border border-border-soft rounded-card shadow-modal overflow-hidden flex flex-col"
      >
        {children}
      </div>
    </div>
  )
}

type ModalHeaderProps = {
  eyebrowTag?: ReactNode
  eyebrowMeta?: ReactNode
  title: ReactNode
  titleId: string
  description?: ReactNode
  onClose: () => void
  closeLabel?: string
  as?: "h2" | "h3"
}

export const ModalHeader = ({
  eyebrowTag,
  eyebrowMeta,
  title,
  titleId,
  description,
  onClose,
  closeLabel = "閉じる",
  as: TitleTag = "h2",
}: ModalHeaderProps) => (
  <div className="px-5 py-3.5 border-b border-border-soft flex items-start gap-3">
    <div className="flex-1 min-w-0">
      {(eyebrowTag !== undefined || eyebrowMeta !== undefined) && (
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {eyebrowTag}
          {eyebrowTag !== undefined && eyebrowMeta !== undefined && (
            <span aria-hidden className="text-ink-soft">·</span>
          )}
          {eyebrowMeta !== undefined && (
            <span className="font-mono text-fs-micro text-ink-mid font-medium">
              {eyebrowMeta}
            </span>
          )}
        </div>
      )}
      <Heading as={TitleTag} size="h2" id={titleId}>
        {title}
      </Heading>
      {description !== undefined && (
        <p className="text-fs-label text-ink-mid mt-1 leading-relaxed">
          {description}
        </p>
      )}
    </div>
    <IconButton ariaLabel={closeLabel} onClick={onClose} size={28}>
      <CloseIcon size={18} />
    </IconButton>
  </div>
)

type ModalBodyProps = {
  children: ReactNode
  cols?: 1 | 2
  minHeight?: number
}

export const ModalBody = ({ children, cols = 1, minHeight = 460 }: ModalBodyProps) => {
  const style: CSSProperties | undefined = cols === 2 ? { minHeight } : undefined
  return (
    <div className={cn(cols === 2 && "flex")} style={style}>
      {children}
    </div>
  )
}

type ModalFooterProps = {
  status?: ReactNode
  actions: ReactNode
}

export const ModalFooter = ({ status, actions }: ModalFooterProps) => (
  <div className="px-5 py-3 border-t border-border-soft bg-surface-subtle flex justify-between items-center gap-2">
    {status !== undefined && (
      <span className="text-fs-micro text-ink-mid">{status}</span>
    )}
    <div className="flex gap-2 ml-auto">{actions}</div>
  </div>
)
