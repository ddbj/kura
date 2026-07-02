import type { ChangeEventHandler, CSSProperties, ReactNode } from "react"

import { cn } from "./cn"

type FacetRowProps = {
  type?: "checkbox" | "radio"
  name?: string
  label: ReactNode
  count?: string | number
  defaultChecked?: boolean
  checked?: boolean
  swatch?: string
  mono?: boolean
  compact?: boolean
  sub?: ReactNode
  value?: string
  onChange?: ChangeEventHandler<HTMLInputElement>
}

export const FacetRow = ({
  type = "checkbox",
  name,
  label,
  count,
  defaultChecked,
  checked,
  swatch,
  mono = false,
  compact = false,
  sub,
  value,
  onChange,
}: FacetRowProps) => {
  const isChecked = checked ?? defaultChecked ?? false
  const swatchStyle: CSSProperties | undefined = swatch === undefined ? undefined : { background: swatch }

  return (
    <li
      className={cn(
        "flex items-center gap-2 text-fs-body",
        compact ? "py-0.5" : "py-1",
      )}
    >
      <label className="flex items-center gap-2 cursor-pointer w-full">
        <input
          type={type}
          name={name}
          value={value}
          checked={checked}
          defaultChecked={defaultChecked}
          onChange={onChange}
          className="w-3.5 h-3.5 m-0 accent-brand"
        />
        {swatch !== undefined && (
          <span
            aria-hidden
            className="w-2 h-2 rounded-pill shrink-0"
            style={swatchStyle}
          />
        )}
        <span
          className={cn(
            "text-ink flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
            mono ? "font-mono text-fs-label" : "font-sans text-fs-body-sm",
            isChecked ? "font-semibold" : "font-normal",
          )}
        >
          {label}
          {sub !== undefined && (
            <span className="ml-1.5 font-mono text-fs-micro text-ink-soft font-normal">
              {sub}
            </span>
          )}
        </span>
        {count !== undefined && (
          <span className="text-ink-soft font-mono text-fs-label">{count}</span>
        )}
      </label>
    </li>
  )
}
