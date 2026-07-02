import { render, screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { describe, expect, test } from "vitest"

import { CopyField } from "~/ui/copy-field"

const props = {
  ariaLabel: "共有 URL",
  copyLabel: "コピー",
  copiedLabel: "コピーしました",
}

describe("CopyField", () => {
  test("CopyField_copyButton_writesValueToClipboard", async () => {
    const user = userEvent.setup()
    render(<CopyField value="https://kura.example/u/a.txt" {...props} />)

    expect(screen.getByRole("textbox", { name: "共有 URL" })).toHaveValue("https://kura.example/u/a.txt")
    await user.click(screen.getByRole("button", { name: "コピー" }))

    expect(await screen.findByRole("button", { name: "コピーしました" })).toBeInTheDocument()
    await expect(navigator.clipboard.readText()).resolves.toBe("https://kura.example/u/a.txt")
  })

  test("CopyField_valueChange_resetsCopiedLabel", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CopyField value="first" {...props} />)
    await user.click(screen.getByRole("button", { name: "コピー" }))
    expect(await screen.findByRole("button", { name: "コピーしました" })).toBeInTheDocument()

    rerender(<CopyField value="second" {...props} />)
    expect(screen.getByRole("button", { name: "コピー" })).toBeInTheDocument()
  })
})
