import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { Tag } from "~/ui/tag"

describe("Tag", () => {
  test("Tag_children_renderAsText", () => {
    render(<Tag>label</Tag>)
    expect(screen.getByText("label")).toBeInTheDocument()
  })

  test("Tag_sourceKind_rendersNameProp", () => {
    render(<Tag kind="source" name="DDBJ" />)
    expect(screen.getByText("DDBJ")).toBeInTheDocument()
  })
})
