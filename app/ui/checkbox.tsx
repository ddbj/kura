import { cn } from "./cn"
import { Icon } from "./icon"

type Props = {
  checked: boolean
  onChange: (next: boolean) => void
  ariaLabel: string
  className?: string
}

// Handoff .cbx pattern: a bordered square that turns brand-filled when checked,
// rendered as a real <button role=checkbox> for accessibility.
export const Checkbox = ({ checked, onChange, ariaLabel, className }: Props) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    aria-label={ariaLabel}
    className={cn("cbx", { on: checked }, className)}
    onClick={() => onChange(!checked)}
  >
    {checked ? <Icon name="check" size={12} /> : null}
  </button>
)
