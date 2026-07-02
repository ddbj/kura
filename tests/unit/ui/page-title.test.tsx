import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { PageTitle } from "~/ui/page-title"

describe("PageTitle", () => {
  test("PageTitle_titleOnly_rendersH1WithFs1AndTrackingH1", () => {
    render(<PageTitle title="タイトル" />)
    const node = screen.getByRole("heading", { level: 1, name: "タイトル" })
    expect(node).toHaveClass("text-fs-h1")
    expect(node).toHaveClass("font-extrabold")
    expect(node).toHaveClass("text-ink")
    expect(node).toHaveClass("m-0")
    expect(node).toHaveClass("tracking-h1")
    expect(node).toHaveClass("leading-none")
  })

  test("PageTitle_outer_appliesPageGutterAndVerticalPadding", () => {
    const { container } = render(<PageTitle title="x" />)
    const outer = container.firstElementChild
    expect(outer).toHaveClass("px-page-gutter")
    expect(outer).toHaveClass("pt-9")
    expect(outer).toHaveClass("pb-6")
  })

  test("PageTitle_eyebrow_rendersMonoBrandEyebrow", () => {
    render(<PageTitle title="x" eyebrow="DESIGN PREVIEW" />)
    const eyebrow = screen.getByText("DESIGN PREVIEW")
    expect(eyebrow).toHaveClass("text-brand")
    expect(eyebrow).toHaveClass("font-mono")
    expect(eyebrow).toHaveClass("uppercase")
    expect(eyebrow).toHaveClass("tracking-eyebrow")
    expect(eyebrow).toHaveClass("text-fs-label")
    expect(eyebrow).toHaveClass("font-bold")
  })

  test("PageTitle_noEyebrow_doesNotRenderEyebrowNode", () => {
    const { container } = render(<PageTitle title="タイトル" />)
    expect(container.querySelector(".tracking-eyebrow")).toBeNull()
  })

  test("PageTitle_subtitle_rendersBodyInkMidParagraph", () => {
    render(<PageTitle title="x" subtitle="補足説明" />)
    const sub = screen.getByText("補足説明")
    expect(sub.tagName).toBe("P")
    expect(sub).toHaveClass("text-fs-body")
    expect(sub).toHaveClass("text-ink-mid")
    expect(sub).toHaveClass("leading-relaxed")
    expect(sub).toHaveClass("mt-3")
    expect(sub).toHaveClass("max-w-content-narrow")
  })

  test("PageTitle_noSubtitle_doesNotRenderSubtitleParagraph", () => {
    const { container } = render(<PageTitle title="x" />)
    expect(container.querySelector("p")).toBeNull()
  })

  test("PageTitle_maxWidth_appliesInlineMaxWidthOnInnerWrapper", () => {
    const { container } = render(<PageTitle title="x" maxWidth={820} />)
    const inner = container.querySelector(".max-w-content-max")
    expect(inner).toHaveStyle({ maxWidth: "820px" })
  })

  test("PageTitle_noMaxWidth_hasNoInlineStyleOnInnerWrapper", () => {
    const { container } = render(<PageTitle title="x" />)
    const inner = container.querySelector(".max-w-content-max")
    expect(inner).not.toHaveAttribute("style")
  })

  test("PageTitle_meta_rendersNodeAlongsideH1", () => {
    render(<PageTitle title="タイトル" meta={<span data-testid="meta">M</span>} />)
    const h1 = screen.getByRole("heading", { level: 1, name: "タイトル" })
    const meta = screen.getByTestId("meta")
    expect(meta).toBeInTheDocument()
    expect(h1.parentElement).toBe(meta.parentElement?.parentElement ?? null)
  })

  test("PageTitle_noMeta_doesNotRenderMetaSlot", () => {
    const { container } = render(<PageTitle title="x" />)
    const flex = container.querySelector(".flex.items-center")
    expect(flex?.children.length).toBe(1)
  })
})
