import { CloseIcon } from "./icons"
import { Label } from "./label"

export type AppliedFilter = {
  label: string
  value: string
  onClear?: () => void
}

type AppliedFiltersProps = {
  applied: readonly AppliedFilter[]
  onClearAll?: () => void
  appliedLabel?: string
  clearAllLabel?: string
  removeFilterLabel?: string
}

export const AppliedFilters = ({
  applied,
  onClearAll,
  appliedLabel = "適用中",
  clearAllLabel = "すべて解除",
  removeFilterLabel = "を解除",
}: AppliedFiltersProps) => {
  if (applied.length === 0) return null

  return (
    <div className="pb-3 border-b border-border-soft">
      <div className="flex items-center justify-between mb-2.5">
        <Label>{appliedLabel} · {applied.length}</Label>
        {onClearAll && (
          <button
            type="button"
            onClick={onClearAll}
            className="bg-transparent border-0 text-brand text-fs-label font-semibold cursor-pointer p-0 font-sans"
          >
            {clearAllLabel}
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-1.5 list-none p-0 m-0">
        {applied.map((f, i) => (
          <li
            key={`${f.label}:${f.value}:${i}`}
            className="inline-flex items-stretch text-fs-label leading-snug border border-border-soft rounded-button overflow-hidden bg-surface"
          >
            <span className="px-2 py-1 bg-brand-soft text-brand-deep font-semibold text-fs-micro inline-flex items-center border-r border-border-soft whitespace-nowrap">
              {f.label}
            </span>
            <span className="px-2 py-1 text-ink flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap inline-flex items-center">
              {f.value}
            </span>
            {f.onClear && (
              <button
                type="button"
                aria-label={`${f.label}: ${f.value} ${removeFilterLabel}`}
                onClick={f.onClear}
                className="px-2 bg-transparent border-0 border-l border-border-soft cursor-pointer text-ink-soft inline-flex items-center justify-center hover:text-ink"
              >
                <CloseIcon size={12} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
