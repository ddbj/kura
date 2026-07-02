import { Pagination } from "./pagination"

type ResultsPaginationProps = {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  ariaLabel: string
  prevLabel: string
  nextLabel: string
  jumpToLastLabel: (n: number) => string
}

export const ResultsPagination = (props: ResultsPaginationProps) => {
  if (props.totalPages <= 1) return null

  return <Pagination {...props} />
}
