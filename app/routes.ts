import type { RouteConfig } from "@react-router/dev/routes"
import { index, layout, route } from "@react-router/dev/routes"

export default [
  layout("routes/layout.tsx", [
    index("routes/browse/index.tsx"),
    route("_browse/*", "routes/browse/splat.tsx"),
    route("_auth/callback", "routes/auth/callback.tsx"),
  ]),
] satisfies RouteConfig
