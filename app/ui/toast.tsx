import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

import { cn } from "./cn"
import { IconButton } from "./icon-button"
import { CloseIcon } from "./icons"

export type ToastKind = "progress" | "success" | "error"

export type ToastInput = {
  kind: ToastKind
  title: string
  description?: string | undefined
  progress?: { loaded: number; total: number } | undefined
  // Rendered flush-right under the message (e.g. a cancel button).
  action?: ReactNode | undefined
}

type ToastItem = ToastInput & { id: number }

export type ToastsApi = {
  show: (toast: ToastInput) => number
  update: (id: number, patch: Partial<ToastInput>) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastsApi | null>(null)

export const useToasts = (): ToastsApi => {
  const api = useContext(ToastContext)
  if (api === null) {
    throw new Error("useToasts must be used within a ToastProvider")
  }

  return api
}

const SUCCESS_DISMISS_MS = 5000

const accentClass: Record<ToastKind, string> = {
  progress: "border-l-brand",
  success: "border-l-ok-fg",
  error: "border-l-red",
}

const ProgressBar = ({ loaded, total }: { loaded: number; total: number }) => {
  const percent = total > 0 ? Math.min(100, Math.floor((loaded / total) * 100)) : 0

  return (
    <div className="mt-2 flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-subtle"
      >
        <div className="h-full bg-brand" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-fs-micro text-ink-soft tabular-nums">{percent}%</span>
    </div>
  )
}

const ToastCard = ({ toast, dismissLabel, dismiss }: {
  toast: ToastItem
  dismissLabel: string
  dismiss: (id: number) => void
}) => {
  useEffect(() => {
    if (toast.kind !== "success") return
    const timer = setTimeout(() => dismiss(toast.id), SUCCESS_DISMISS_MS)

    return () => clearTimeout(timer)
  }, [toast.kind, toast.id, dismiss])

  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={cn(
        "border border-border-soft border-l-3 rounded-card bg-surface shadow-modal px-3.5 py-2.5",
        accentClass[toast.kind],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-fs-body-sm font-medium text-ink break-all">{toast.title}</p>
          {toast.description !== undefined && (
            <p className="mt-0.5 text-fs-label text-ink-soft break-all">{toast.description}</p>
          )}
        </div>
        <IconButton ariaLabel={dismissLabel} size={22} onClick={() => dismiss(toast.id)}>
          <CloseIcon />
        </IconButton>
      </div>
      {toast.progress !== undefined && <ProgressBar {...toast.progress} />}
      {toast.action !== undefined && <div className="mt-2 flex justify-end">{toast.action}</div>}
    </div>
  )
}

export const ToastProvider = ({ dismissLabel, children }: {
  // ui primitives take copy via props; i18n lives outside this zone.
  dismissLabel: string
  children: ReactNode
}) => {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const show = useCallback((toast: ToastInput): number => {
    const id = nextId.current
    nextId.current += 1
    setToasts((prev) => [...prev, { ...toast, id }])

    return id
  }, [])

  const update = useCallback((id: number, patch: Partial<ToastInput>): void => {
    setToasts((prev) => prev.map((toast) => (toast.id === id ? { ...toast, ...patch } : toast)))
  }, [])

  const dismiss = useCallback((id: number): void => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const api = useMemo(() => ({ show, update, dismiss }), [show, update, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-toast flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} dismissLabel={dismissLabel} dismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
