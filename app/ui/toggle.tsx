import { cn } from "./cn"

type ToggleProps = {
  checked: boolean
  onChange: (next: boolean) => void
  ariaLabel: string
  disabled?: boolean
}

// A real switch (not a button whose label changes) so a public/private flip
// reads as a toggle at a glance instead of needing to parse button text.
export const Toggle = ({ checked, onChange, ariaLabel, disabled = false }: ToggleProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled || undefined}
    onClick={() => onChange(!checked)}
    className={cn(
      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill transition-colors",
      checked ? "bg-brand" : "bg-border-soft",
      disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer",
    )}
  >
    <span
      className={cn(
        "inline-block h-3.5 w-3.5 transform rounded-pill bg-surface transition-transform",
        checked ? "translate-x-5" : "translate-x-0.5",
      )}
    />
  </button>
)
