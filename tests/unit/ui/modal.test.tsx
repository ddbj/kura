import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, test, vi } from "vitest"

import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from "~/ui"

type HarnessProps = { onClose?: () => void }

const Harness = ({ onClose }: HarnessProps) => {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <Button onClick={() => setOpen(true)}>open</Button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false)
          onClose?.()
        }}
        ariaLabelledby="modal-title"
      >
        <ModalHeader
          title="dialog"
          titleId="modal-title"
          onClose={() => {
            setOpen(false)
            onClose?.()
          }}
        />
        <ModalBody>
          <input aria-label="first" />
          <input aria-label="last" />
        </ModalBody>
        <ModalFooter
          actions={<Button onClick={() => setOpen(false)}>close-action</Button>}
        />
      </Modal>
    </div>
  )
}

describe("Modal", () => {
  test("Modal_open_setsDialogRoleAndAria", () => {
    render(<Harness />)
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "open" }))
    })
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog).toHaveAttribute("aria-labelledby", "modal-title")
  })

  test("Modal_headerAsH3_rendersAsH3", () => {
    render(
      <Modal open onClose={() => undefined} ariaLabelledby="t">
        <ModalHeader title="dialog" titleId="t" as="h3" onClose={() => undefined} />
      </Modal>,
    )
    const heading = screen.getByRole("heading", { level: 3, name: "dialog" })
    expect(heading).toHaveAttribute("id", "t")
  })

  test("Modal_headerAsDefault_rendersAsH2", () => {
    render(
      <Modal open onClose={() => undefined} ariaLabelledby="t">
        <ModalHeader title="dialog" titleId="t" onClose={() => undefined} />
      </Modal>,
    )
    expect(screen.getByRole("heading", { level: 2, name: "dialog" })).toBeInTheDocument()
  })

  test("Modal_closed_doesNotRender", () => {
    render(<Harness />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  test("Modal_escapeKey_closes", () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "open" }))
    })
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" })
    })
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  test("Modal_tabAtLast_wrapsToFirstFocusable", () => {
    render(<Harness />)
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "open" }))
    })
    const last = screen.getByRole("button", { name: "close-action" })
    last.focus()
    act(() => {
      fireEvent.keyDown(document, { key: "Tab" })
    })
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "閉じる" }))
  })

  test("Modal_shiftTabAtFirst_wrapsToLastFocusable", () => {
    render(<Harness />)
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "open" }))
    })
    const closeBtn = screen.getByRole("button", { name: "閉じる" })
    closeBtn.focus()
    act(() => {
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    })
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "close-action" }))
  })

  test("Modal_close_restoresFocusToTrigger", () => {
    render(<Harness />)
    const opener = screen.getByRole("button", { name: "open" })
    opener.focus()
    act(() => {
      fireEvent.click(opener)
    })
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" })
    })
    expect(document.activeElement).toBe(opener)
  })

  test("Modal_closeOnEscapeFalse_escapeDoesNotClose", () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} ariaLabelledby="t" closeOnEscape={false}>
        <ModalHeader title="dialog" titleId="t" onClose={onClose} />
      </Modal>,
    )
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" })
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  test("Modal_closeOnOverlayDefault_overlayPointerThenClickClosesOnce", () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} ariaLabelledby="t">
        <ModalHeader title="dialog" titleId="t" onClose={onClose} />
      </Modal>,
    )
    const overlay = screen.getByRole("dialog").parentElement!
    act(() => {
      fireEvent.pointerDown(overlay, { target: overlay })
      fireEvent.click(overlay, { target: overlay })
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test("Modal_closeOnOverlayFalse_overlayClickDoesNotClose", () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} ariaLabelledby="t" closeOnOverlay={false}>
        <ModalHeader title="dialog" titleId="t" onClose={onClose} />
      </Modal>,
    )
    const overlay = screen.getByRole("dialog").parentElement!
    act(() => {
      fireEvent.pointerDown(overlay, { target: overlay })
      fireEvent.click(overlay, { target: overlay })
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  test("Modal_pointerDownInsideThenDragToOverlay_doesNotClose", () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} ariaLabelledby="t">
        <ModalHeader title="dialog" titleId="t" onClose={onClose} />
        <ModalBody>
          <button>inside</button>
        </ModalBody>
      </Modal>,
    )
    const dialog = screen.getByRole("dialog")
    const overlay = dialog.parentElement!
    act(() => {
      fireEvent.pointerDown(overlay, { target: dialog })
      fireEvent.click(overlay, { target: overlay })
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  test("Modal_ariaDescribedby_isAppliedToDialog", () => {
    render(
      <Modal open onClose={() => undefined} ariaLabelledby="t" ariaDescribedby="d">
        <ModalHeader title="dialog" titleId="t" onClose={() => undefined} />
      </Modal>,
    )
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-describedby", "d")
  })

  test("Modal_open_lockBodyOverflowHidden_andCloseRestores", () => {
    document.body.style.overflow = "scroll"
    const { rerender } = render(
      <Modal open onClose={() => undefined} ariaLabelledby="t">
        <ModalHeader title="dialog" titleId="t" onClose={() => undefined} />
      </Modal>,
    )
    expect(document.body.style.overflow).toBe("hidden")
    rerender(
      <Modal open={false} onClose={() => undefined} ariaLabelledby="t">
        <ModalHeader title="dialog" titleId="t" onClose={() => undefined} />
      </Modal>,
    )
    expect(document.body.style.overflow).toBe("scroll")
  })

  test("Modal_widthCustom_appliesInlineWidth", () => {
    render(
      <Modal open onClose={() => undefined} ariaLabelledby="t" width={420}>
        <ModalHeader title="dialog" titleId="t" onClose={() => undefined} />
      </Modal>,
    )
    expect(screen.getByRole("dialog")).toHaveStyle({ width: "420px" })
  })
})

describe("ModalHeader", () => {
  test("ModalHeader_eyebrowTagAndMeta_rendersDividerBetween", () => {
    render(
      <ModalHeader
        title="t"
        titleId="t-id"
        eyebrowTag={<span>tag-content</span>}
        eyebrowMeta="meta-content"
        onClose={() => undefined}
      />,
    )
    expect(screen.getByText("tag-content")).toBeInTheDocument()
    expect(screen.getByText("meta-content")).toBeInTheDocument()
    expect(screen.getByText("·")).toHaveAttribute("aria-hidden")
  })

  test("ModalHeader_eyebrowTagOnly_doesNotRenderDivider", () => {
    render(
      <ModalHeader
        title="t"
        titleId="t-id"
        eyebrowTag={<span>only-tag</span>}
        onClose={() => undefined}
      />,
    )
    expect(screen.queryByText("·")).toBeNull()
  })

  test("ModalHeader_eyebrowMetaOnly_doesNotRenderDivider", () => {
    render(
      <ModalHeader
        title="t"
        titleId="t-id"
        eyebrowMeta="only-meta"
        onClose={() => undefined}
      />,
    )
    expect(screen.queryByText("·")).toBeNull()
  })

  test("ModalHeader_noEyebrow_doesNotRenderEyebrowRow", () => {
    const { container } = render(
      <ModalHeader title="t" titleId="t-id" onClose={() => undefined} />,
    )
    expect(screen.queryByText("·")).toBeNull()
    const eyebrowSibling = container.querySelector(".flex.items-center.gap-2.mb-1.flex-wrap")
    expect(eyebrowSibling).toBeNull()
  })

  test("ModalHeader_customCloseLabel_isUsedAsAriaLabel", () => {
    render(
      <ModalHeader
        title="t"
        titleId="t-id"
        closeLabel="キャンセル"
        onClose={() => undefined}
      />,
    )
    expect(screen.getByRole("button", { name: "キャンセル" })).toBeInTheDocument()
  })

  test("ModalHeader_closeClick_invokesOnClose", () => {
    const onClose = vi.fn()
    render(
      <ModalHeader title="t" titleId="t-id" onClose={onClose} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test("ModalHeader_description_rendersBelowTitle", () => {
    render(
      <ModalHeader
        title="t"
        titleId="t-id"
        description="補足説明"
        onClose={() => undefined}
      />,
    )
    expect(screen.getByText("補足説明")).toBeInTheDocument()
  })

  test("ModalHeader_titleClass_matchesSectionHeadingH2Tokens", () => {
    render(
      <ModalHeader title="t" titleId="t-id" onClose={() => undefined} />,
    )
    const heading = screen.getByRole("heading", { level: 2, name: "t" })
    expect(heading).toHaveClass("text-fs-h2", "font-bold", "text-ink", "leading-tight")
    expect(heading).not.toHaveClass("tracking-tight")
  })
})
