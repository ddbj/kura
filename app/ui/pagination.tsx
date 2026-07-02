import { cn } from "./cn"

type PaginationProps = {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  maxNumbers?: number
  ariaLabel?: string
  prevLabel?: string
  nextLabel?: string
  jumpToLastLabel?: (n: number) => string
}

const btnClass = (isActive: boolean, isDisabled: boolean): string =>
  cn(
    "min-w-7 h-7 px-2 rounded-button text-fs-label font-semibold font-mono inline-flex items-center justify-center border",
    isActive
      ? "border-brand bg-brand text-white"
      : isDisabled
        ? "border-border-soft bg-surface text-ink-soft cursor-not-allowed opacity-55"
        : "border-border-soft bg-surface text-ink cursor-pointer",
  )

const computeNumbers = (page: number, totalPages: number, maxNumbers: number): readonly number[] => {
  if (totalPages <= maxNumbers) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const half = Math.floor(maxNumbers / 2)
  let start = Math.max(1, page - half)
  let end = start + maxNumbers - 1
  if (end > totalPages) {
    end = totalPages
    start = Math.max(1, end - maxNumbers + 1)
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

export const Pagination = ({
  page,
  totalPages,
  onPageChange,
  maxNumbers = 5,
  ariaLabel = "Pagination",
  prevLabel = "Previous page",
  nextLabel = "Next page",
  jumpToLastLabel = (n) => `Jump to page ${n}`,
}: PaginationProps) => {
  if (totalPages <= 0) return null

  const numbers = computeNumbers(page, totalPages, maxNumbers)
  const showLastJump = totalPages > maxNumbers && !numbers.includes(totalPages)

  return (
    <nav aria-label={ariaLabel} className="inline-flex gap-0.5">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-disabled={page <= 1 || undefined}
        aria-label={prevLabel}
        className={btnClass(false, page <= 1)}
      >
        ‹
      </button>
      {numbers.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPageChange(n)}
          aria-current={n === page ? "page" : undefined}
          className={btnClass(n === page, false)}
        >
          {n}
        </button>
      ))}
      {showLastJump && (
        <>
          <span
            aria-hidden
            className="self-center text-ink-soft px-1 font-mono text-fs-label"
          >
            …
          </span>
          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            aria-label={jumpToLastLabel(totalPages)}
            className={btnClass(false, false)}
          >
            {totalPages}
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-disabled={page >= totalPages || undefined}
        aria-label={nextLabel}
        className={btnClass(false, page >= totalPages)}
      >
        ›
      </button>
    </nav>
  )
}
