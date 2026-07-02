import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { Pagination } from "~/ui/pagination"

describe("Pagination", () => {
  test("Pagination_zeroTotalPages_rendersNothing", () => {
    const { container } = render(
      <Pagination page={1} totalPages={0} onPageChange={() => undefined} />,
    )
    expect(container.firstChild).toBeNull()
  })

  test("Pagination_currentPage_hasAriaCurrent", () => {
    render(<Pagination page={3} totalPages={5} onPageChange={() => undefined} />)
    const current = screen.getByRole("button", { current: "page" })
    expect(current).toHaveTextContent("3")
  })

  test("Pagination_firstPage_prevDisabled", () => {
    render(<Pagination page={1} totalPages={10} onPageChange={() => undefined} />)
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled()
  })

  test("Pagination_lastPage_nextDisabled", () => {
    render(<Pagination page={10} totalPages={10} onPageChange={() => undefined} />)
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled()
  })

  test("Pagination_clickNumber_callsOnPageChange", () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} totalPages={5} onPageChange={onPageChange} />)
    fireEvent.click(screen.getByRole("button", { name: "4" }))
    expect(onPageChange).toHaveBeenCalledWith(4)
  })

  test("Pagination_manyPages_showsLastJump", () => {
    render(<Pagination page={2} totalPages={50} onPageChange={() => undefined} />)
    expect(screen.getByText("…")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Jump to page 50" })).toBeInTheDocument()
  })

  test("Pagination_currentAtEnd_doesNotShowLastJump", () => {
    render(<Pagination page={50} totalPages={50} onPageChange={() => undefined} />)
    expect(screen.queryByText("…")).toBeNull()
  })

  test("Pagination_singlePage_bothPrevNextDisabled", () => {
    render(<Pagination page={1} totalPages={1} onPageChange={() => undefined} />)
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled()
  })

  test("Pagination_clickPrev_callsOnPageChangeWithPrevPage", () => {
    const onPageChange = vi.fn()
    render(<Pagination page={3} totalPages={5} onPageChange={onPageChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  test("Pagination_clickNext_callsOnPageChangeWithNextPage", () => {
    const onPageChange = vi.fn()
    render(<Pagination page={3} totalPages={5} onPageChange={onPageChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(onPageChange).toHaveBeenCalledWith(4)
  })

  test("Pagination_clickLastJump_callsOnPageChangeWithTotalPages", () => {
    const onPageChange = vi.fn()
    render(<Pagination page={2} totalPages={50} onPageChange={onPageChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Jump to page 50" }))
    expect(onPageChange).toHaveBeenCalledWith(50)
  })

  test("Pagination_customLabels_areUsedForAriaLabels", () => {
    render(
      <Pagination
        page={2}
        totalPages={50}
        onPageChange={() => undefined}
        ariaLabel="ページング"
        prevLabel="前へ"
        nextLabel="次へ"
        jumpToLastLabel={(n) => `最終 ${n} ページへ`}
      />,
    )
    expect(screen.getByRole("navigation", { name: "ページング" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "前へ" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "次へ" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "最終 50 ページへ" })).toBeInTheDocument()
  })

  test("Pagination_currentNumber_appliesBrandPalette", () => {
    render(<Pagination page={3} totalPages={5} onPageChange={() => undefined} />)
    const current = screen.getByRole("button", { current: "page" })
    expect(current).toHaveClass("bg-brand", "text-white", "border-brand")
  })

  test("Pagination_disabledButton_appliesNotAllowedCursor", () => {
    render(<Pagination page={1} totalPages={3} onPageChange={() => undefined} />)
    expect(screen.getByRole("button", { name: "Previous page" }))
      .toHaveClass("cursor-not-allowed", "opacity-55")
  })
})
