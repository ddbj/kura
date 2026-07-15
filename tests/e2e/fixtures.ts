// Custom fixture for the chromium-user project only. Reads the sessionStorage
// snapshot captured by auth.setup.ts and re-injects it into every context via
// addInitScript. anon specs (config.spec.ts, auth.spec.ts) import test from
// @playwright/test directly and skip this fixture (scenarios.md §5.2).
import { readFileSync } from "node:fs"

import { test as base } from "@playwright/test"

const SESSION = "tests/e2e/.auth/user.session.json"

export const test = base.extend({
  page: async ({ page, context }, use) => {
    const snapshot = readFileSync(SESSION, "utf8")
    await context.addInitScript((raw: string) => {
      const data = JSON.parse(raw) as Record<string, string>
      for (const [k, v] of Object.entries(data)) sessionStorage.setItem(k, v)
    }, snapshot)

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page)
  },
})

export { expect } from "@playwright/test"
