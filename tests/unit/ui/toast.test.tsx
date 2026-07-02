import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useEffect } from "react"
import { afterEach, describe, expect, test, vi } from "vitest"

import type { ToastsApi } from "~/ui/toast"
import { ToastProvider, useToasts } from "~/ui/toast"

const Harness = ({ apiRef }: { apiRef: { current: ToastsApi | null } }) => {
  const api = useToasts()
  useEffect(() => {
    apiRef.current = api
  }, [api, apiRef])

  return null
}

const renderToasts = () => {
  const apiRef: { current: ToastsApi | null } = { current: null }
  render(
    <ToastProvider dismissLabel="close">
      <Harness apiRef={apiRef} />
    </ToastProvider>,
  )

  return apiRef.current!
}

afterEach(() => {
  vi.useRealTimers()
})

describe("ToastProvider", () => {
  test("show_progressToast_rendersTitleAndProgressbar", () => {
    const api = renderToasts()
    act(() => {
      api.show({ kind: "progress", title: "a.txt", progress: { loaded: 25, total: 100 } })
    })

    const toast = screen.getByRole("status")
    expect(toast).toHaveTextContent("a.txt")
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25")
  })

  test("show_errorToast_hasAlertRole", () => {
    const api = renderToasts()
    act(() => {
      api.show({ kind: "error", title: "failed", description: "boom" })
    })

    expect(screen.getByRole("alert")).toHaveTextContent("failed")
    expect(screen.getByRole("alert")).toHaveTextContent("boom")
  })

  test("show_zeroTotalProgress_rendersZeroPercent", () => {
    const api = renderToasts()
    act(() => {
      api.show({ kind: "progress", title: "empty.bin", progress: { loaded: 0, total: 0 } })
    })

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0")
  })

  test("update_progressValue_updatesProgressbar", () => {
    const api = renderToasts()
    let id = 0
    act(() => {
      id = api.show({ kind: "progress", title: "a.txt", progress: { loaded: 0, total: 200 } })
    })
    act(() => {
      api.update(id, { progress: { loaded: 100, total: 200 } })
    })

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50")
  })

  test("dismissButton_removesToast", async () => {
    const user = userEvent.setup()
    const api = renderToasts()
    act(() => {
      api.show({ kind: "error", title: "failed" })
    })

    await user.click(screen.getByRole("button", { name: "close" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  test("dismiss_byId_removesToast", () => {
    const api = renderToasts()
    let id = 0
    act(() => {
      id = api.show({ kind: "progress", title: "a.txt" })
    })
    act(() => {
      api.dismiss(id)
    })

    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  test("successToast_autoDismisses", () => {
    vi.useFakeTimers()
    const api = renderToasts()
    act(() => {
      api.show({ kind: "success", title: "done" })
    })
    expect(screen.getByRole("status")).toHaveTextContent("done")

    act(() => {
      vi.advanceTimersByTime(6000)
    })
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  test("progressToast_isNotAutoDismissed", () => {
    vi.useFakeTimers()
    const api = renderToasts()
    act(() => {
      api.show({ kind: "progress", title: "a.txt", progress: { loaded: 0, total: 1 } })
    })

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByRole("status")).toBeInTheDocument()
  })

  test("update_progressToSuccess_autoDismissesAndDropsProgressbar", () => {
    vi.useFakeTimers()
    const api = renderToasts()
    let id = 0
    act(() => {
      id = api.show({ kind: "progress", title: "a.txt", progress: { loaded: 1, total: 2 } })
    })
    act(() => {
      api.update(id, { kind: "success", progress: undefined })
    })
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(6000)
    })
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  test("action_isRendered", async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const api = renderToasts()
    act(() => {
      api.show({
        kind: "progress",
        title: "a.txt",
        action: <button type="button" onClick={onCancel}>cancel</button>,
      })
    })

    await user.click(screen.getByRole("button", { name: "cancel" }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test("useToasts_outsideProvider_throws", () => {
    const Naked = () => {
      useToasts()

      return null
    }
    expect(() => render(<Naked />)).toThrow(/ToastProvider/)
  })
})
