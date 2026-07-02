import type { ChangeEventHandler, ReactNode } from "react"

import { cn } from "./cn"

type FmtCheckProps = {
  name?: string
  label: ReactNode
  sub?: ReactNode
  value?: string
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  onChange?: ChangeEventHandler<HTMLInputElement>
}

export const FmtCheck = ({
  name,
  label,
  sub,
  value,
  checked,
  defaultChecked,
  disabled,
  onChange,
}: FmtCheckProps) => {
  const isChecked = checked ?? defaultChecked ?? false

  return (
    <label
      className={cn(
        "flex items-start gap-2.5 px-3 py-2 rounded-button text-fs-body-sm text-ink leading-snug border",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        isChecked
          ? "bg-brand-softer border-brand-light/50"
          : "bg-surface border-border-soft",
      )}
    >
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        onChange={onChange}
        className="mt-1 shrink-0 accent-brand"
      />
      <span className="flex-1 min-w-0">
        <span className={isChecked ? "font-semibold" : "font-medium"}>{label}</span>
        {sub !== undefined && (
          <span
            className={cn(
              "block text-fs-micro mt-0.5 font-normal",
              isChecked ? "text-brand-deep" : "text-ink-mid",
            )}
          >
            {sub}
          </span>
        )}
      </span>
    </label>
  )
}
