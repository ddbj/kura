import { Icon } from "./icon"

type Props = {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  ariaLabel?: string
}

// Handoff .search: rounded box with a lens icon that turns brand-colored when
// the input is non-empty.
export const SearchInput = ({ value, onChange, placeholder, ariaLabel }: Props) => (
  <div className="search">
    <Icon name="search" size={16} style={{ color: value === "" ? "var(--inkSofter)" : "var(--brand)" }} />
    <input
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  </div>
)
