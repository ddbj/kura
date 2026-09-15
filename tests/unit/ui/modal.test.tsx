import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, test, vi } from "vitest"

import { Button, Modal } from "~/ui"

// Every modal in the app shares this implementation, so a regression here
// reaches rename / move / copy / delete / share / new-folder at once.

const Body = () => (
  <>
    <h2 id="dialog-title">Title</h2>
    <Button>first</Button>
    <Button>second</Button>
    <Button>third</Button>
  </>
)

// Mirrors how callers mount a modal: a trigger outside it owns the open state,
// so focus has somewhere to return to.
const Harness = ({ onClose }: { onClose?: () => void } = {}) => {
  const [open, setOpen] = useState(false)
  const close = () => {
    setOpen(false)
    onClose?.()
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>open</Button>
      <Modal open={open} onClose={close} labelledBy="dialog-title">
        <Body />
      </Modal>
    </>
  )
}

describe("Modal", () => {
  test("Modal_closed_rendersNothing", () => {
    render(<Modal open={false} onClose={vi.fn()}><Body /></Modal>)

    expect(screen.queryByRole("dialog")).toBeNull()
  })

  test("Modal_open_isALabelledModalDialog", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "open" }))

    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog).toHaveAccessibleName("Title")
  })

  // Without this the keyboard lands wherever it was before the dialog opened.
  test("Modal_open_movesFocusToTheFirstControl", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "open" }))

    expect(screen.getByRole("button", { name: "first" })).toHaveFocus()
  })

  test("Modal_tabFromTheLastControl_wrapsToTheFirst", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "open" }))

    await user.tab()
    expect(screen.getByRole("button", { name: "second" })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: "third" })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus()
  })

  test("Modal_shiftTabFromTheFirstControl_wrapsToTheLast", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "open" }))

    await user.tab({ shift: true })
    expect(screen.getByRole("button", { name: "third" })).toHaveFocus()
  })

  test("Modal_escape_closes", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await user.click(screen.getByRole("button", { name: "open" }))

    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  // Returning focus to the trigger is what keeps keyboard use from restarting
  // at the top of the page after every dialog.
  test("Modal_afterClosing_returnsFocusToTheTrigger", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole("button", { name: "open" })
    await user.click(trigger)
    await user.keyboard("{Escape}")

    expect(trigger).toHaveFocus()
  })

  test("Modal_clickOnTheScrim_closes", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await user.click(screen.getByRole("button", { name: "open" }))

    // The scrim is the dialog's own backdrop; only a click that lands on it
    // (not on the dialog inside it) dismisses.
    const scrim = screen.getByRole("dialog").parentElement
    expect(scrim).not.toBeNull()
    await user.click(scrim as HTMLElement)
    expect(onClose).toHaveBeenCalledOnce()
  })

  test("Modal_clickInsideTheDialog_staysOpen", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await user.click(screen.getByRole("button", { name: "open" }))

    await user.click(screen.getByRole("button", { name: "second" }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  // A parent re-render on every keystroke is the normal case for a modal with
  // a controlled input; re-running the initial focus would pull the caret out
  // of that input.
  test("Modal_parentRerender_doesNotStealFocusBack", async () => {
    const user = userEvent.setup()
    const Controlled = () => {
      const [value, setValue] = useState("")

      return (
        <Modal open onClose={vi.fn()} labelledBy="dialog-title">
          <h2 id="dialog-title">Title</h2>
          <input aria-label="name" value={value} onChange={(e) => setValue(e.target.value)} />
          <Button>after</Button>
        </Modal>
      )
    }
    render(<Controlled />)

    const input = screen.getByLabelText("name")
    expect(input).toHaveFocus()
    await user.type(input, "abc")
    expect(input).toHaveValue("abc")
    expect(input).toHaveFocus()
  })
})
