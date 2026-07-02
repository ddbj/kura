import { Outlet } from "react-router"

import { ShellLayout } from "~/shell"

const Layout = () => (
  <ShellLayout>
    <Outlet />
  </ShellLayout>
)

export default Layout
