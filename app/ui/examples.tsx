import { Chip } from "./chip"

type ExamplesProps = {
  label: string
  items: readonly string[]
  onPick: (item: string) => void
  mono?: boolean
}

// Shared "例:" chip row used by the top hero, the /search input, and the
// results page so the prefix label and chip styling stay identical everywhere.
export const Examples = ({ label, items, onPick, mono = false }: ExamplesProps) => {
  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 text-fs-body-sm">
      <span className="text-ink-mid shrink-0">{label}:</span>
      <ul className="list-none p-0 m-0 flex flex-wrap items-center gap-2">
        {items.map((item) => (
          <li key={item} className="m-0">
            <Chip as="button" kind="example" mono={mono} onClick={() => onPick(item)}>
              {item}
            </Chip>
          </li>
        ))}
      </ul>
    </div>
  )
}
