import type { ReactNode } from "react"

import { Tag } from "./tag"

// optional=true のときのみ optionalLabel を必須にする discriminated union。
// primitive は i18n 非依存で、 caller が翻訳済み文字列を渡す。
type FormGroupBase = {
  num: string
  label: ReactNode
  hint?: ReactNode
  hintId?: string
  children: ReactNode
}

type FormGroupProps = FormGroupBase & (
  | { optional?: false; optionalLabel?: never }
  | { optional: true; optionalLabel: string }
)

export const FormGroup = (props: FormGroupProps) => {
  const { num, label, hint, hintId, children } = props

  return (
    <fieldset
      className="border-0 p-0 m-0"
      aria-describedby={hint !== undefined && hintId !== undefined ? hintId : undefined}
    >
      <legend className="flex items-baseline gap-2 mb-2 flex-wrap p-0">
        <span className="font-mono text-fs-micro font-bold text-brand-deep tracking-tag shrink-0">
          {num}
        </span>
        <span className="text-fs-body font-bold text-ink">{label}</span>
        {props.optional && <Tag size="sm">{props.optionalLabel}</Tag>}
        {hint !== undefined && (
          <span id={hintId} className="text-fs-micro text-ink-mid">{hint}</span>
        )}
      </legend>
      <div className="flex flex-col gap-1">{children}</div>
    </fieldset>
  )
}
