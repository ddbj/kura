import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { ModalPreview, PreviewCard } from "~/ui/modal-preview"

describe("ModalPreview", () => {
  test("ModalPreview_default_rendersLabelAndChildren", () => {
    render(
      <ModalPreview label="プレビュー">
        <div>preview body</div>
      </ModalPreview>,
    )
    expect(screen.getByText("プレビュー")).toBeInTheDocument()
    expect(screen.getByText("preview body")).toBeInTheDocument()
  })

  test("ModalPreview_default_appliesAsidePanelTokensAnd44PercentWidth", () => {
    const { container } = render(
      <ModalPreview label="x">
        <div>body</div>
      </ModalPreview>,
    )
    const aside = container.querySelector("aside")
    expect(aside).not.toBeNull()
    expect(aside).toHaveClass("bg-surface-subtle")
    expect(aside).toHaveClass("border-l")
    expect(aside).toHaveClass("border-border-soft")
    expect(aside).toHaveClass("flex-[0_0_44%]")
  })

  test("ModalPreview_footnote_rendersFootnoteWithMicroText", () => {
    render(
      <ModalPreview label="x" footnote="注釈">
        <div>body</div>
      </ModalPreview>,
    )
    const footnote = screen.getByText("注釈")
    expect(footnote).toHaveClass("text-fs-micro")
    expect(footnote).toHaveClass("text-ink-mid")
  })

  test("ModalPreview_noFootnote_doesNotRenderFootnoteText", () => {
    render(
      <ModalPreview label="x" footnote={undefined}>
        <div>body</div>
      </ModalPreview>,
    )
    expect(screen.queryByText("注釈")).toBeNull()
  })
})

describe("PreviewCard", () => {
  test("PreviewCard_default_rendersSourceTagAndDb", () => {
    render(
      <PreviewCard source="DDBJ" db="BioProject" title="プロジェクト" body="本文" />,
    )
    expect(screen.getByText("DDBJ")).toBeInTheDocument()
    expect(screen.getByText("BioProject")).toBeInTheDocument()
    expect(screen.getByText("プロジェクト")).toBeInTheDocument()
    expect(screen.getByText("本文")).toBeInTheDocument()
  })

  test("PreviewCard_activeTrue_doesNotApplyOpacity", () => {
    const { container } = render(
      <PreviewCard source="DDBJ" db="x" title="t" body="b" active />,
    )
    expect(container.firstElementChild).not.toHaveClass("opacity-50")
  })

  test("PreviewCard_activeFalse_appliesOpacity50", () => {
    const { container } = render(
      <PreviewCard source="DDBJ" db="x" title="t" body="b" active={false} />,
    )
    expect(container.firstElementChild).toHaveClass("opacity-50")
  })

  test("PreviewCard_sourceDDBJ_rendersDdbjSourcePalette", () => {
    render(
      <PreviewCard source="DDBJ" db="x" title="t" body="b" />,
    )
    expect(screen.getByText("DDBJ")).toHaveClass("bg-src-ddbj-soft")
  })

  test("PreviewCard_sourceDBCLS_rendersDbclsSourcePalette", () => {
    render(
      <PreviewCard source="DBCLS" db="x" title="t" body="b" />,
    )
    expect(screen.getByText("DBCLS")).toHaveClass("bg-src-dbcls-soft")
  })
})
