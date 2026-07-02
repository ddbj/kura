import { render, screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { describe, expect, test, vi } from "vitest"

import { FilePickButton } from "~/ui/file-pick-button"

const fileInput = (container: HTMLElement): HTMLInputElement => {
  const input = container.querySelector("input[type=file]")
  expect(input).not.toBeNull()

  return input as HTMLInputElement
}

describe("FilePickButton", () => {
  test("FilePickButton_selectingFiles_callsOnPick", async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    const { container } = render(<FilePickButton onPick={onPick}>アップロード</FilePickButton>)

    expect(screen.getByRole("button", { name: "アップロード" })).toBeInTheDocument()
    const file = new File(["x"], "pick.txt", { type: "text/plain" })
    await user.upload(fileInput(container), file)

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0]?.[0]).toEqual([file])
  })

  test("FilePickButton_sameFileTwice_callsOnPickEachTime", async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    const { container } = render(<FilePickButton onPick={onPick}>select</FilePickButton>)

    const file = new File(["x"], "again.txt", { type: "text/plain" })
    await user.upload(fileInput(container), file)
    await user.upload(fileInput(container), file)

    expect(onPick).toHaveBeenCalledTimes(2)
  })

  test("FilePickButton_multipleFalse_hasSingleSelectionInput", () => {
    const { container } = render(<FilePickButton onPick={() => undefined} multiple={false}>one</FilePickButton>)

    expect(fileInput(container)).not.toHaveAttribute("multiple")
  })
})
