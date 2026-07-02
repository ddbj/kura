import type { ReactNode } from "react"

import { cn } from "./cn"

type ToggleProps = {
  label: ReactNode
  sub?: ReactNode
  checked: boolean
  disabled?: boolean
  onChange: () => void
}

export const Toggle = ({ label, sub, checked, disabled, onChange }: ToggleProps) => (
  <label
    className={cn(
      "flex items-center gap-2.5 select-none",
      disabled ? "cursor-not-allowed" : "cursor-pointer",
    )}
  >
    {/*
      Focusable input は sr-only で視覚的には消える。 keyboard focus を視覚化する
      ため、 親 span に `has-[:focus-visible]:` variant を当てて子 input の
      :focus-visible に追従して ring を出す (WCAG 2.4.7、 Combobox の
      focus:ring-2 ring-brand-light と同じトークン)。 input を span の子に置く
      ことで、 ラベル text が switch role の accessible name に正しく結びつく。
    */}
    {/* role=switch は input に付ける (span と input 両方に持たせると
        NVDA / VoiceOver で「switch」「checkbox」の二重 announce が起きる)。
        span は視覚レイアウトのみ、 accessibility tree では skip される。 */}
    <span
      className={cn(
        "relative inline-flex shrink-0 h-5 w-9 rounded-full transition-colors",
        disabled && "opacity-25",
        checked ? "bg-brand" : "bg-border-soft",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-light has-[:focus-visible]:ring-offset-2",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked && "translate-x-4",
        )}
      />
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
    </span>
    <span className="flex-1 min-w-0">
      <span className="text-fs-body-sm font-medium text-ink">{label}</span>
      {sub !== undefined && (
        <span className="block text-fs-micro text-ink-mid mt-0.5">{sub}</span>
      )}
    </span>
  </label>
)
