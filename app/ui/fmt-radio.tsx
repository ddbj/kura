import type { ChangeEventHandler, ReactNode } from "react"

import { cn } from "./cn"

type FmtRadioProps = {
  name: string
  label: ReactNode
  sub?: ReactNode
  value?: string
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean | undefined
  title?: string | undefined
  onChange?: ChangeEventHandler<HTMLInputElement>
}

export const FmtRadio = ({
  name,
  label,
  sub,
  value,
  checked,
  defaultChecked,
  disabled,
  title,
  onChange,
}: FmtRadioProps) => {
  const isChecked = checked ?? defaultChecked ?? false

  return (
    <label
      title={title}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-button text-fs-body-sm text-ink leading-snug border",
        disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer",
        isChecked
          ? "bg-brand-softer border-brand-light/50"
          : "bg-surface border-border-soft",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        onChange={onChange}
        className="shrink-0 accent-brand"
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
