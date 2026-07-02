import { splatToPrefix } from "~/lib/s3"

import type { Route } from "./+types/splat"
import { BrowsePage } from "./browse-page"

const BrowseSplat = ({ params }: Route.ComponentProps) => (
  <BrowsePage prefix={splatToPrefix(params["*"])} />
)

export default BrowseSplat
