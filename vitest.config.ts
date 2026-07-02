import { fileURLToPath, URL } from "node:url"

import { defineConfig } from "vitest/config"

const appDir = fileURLToPath(new URL("./app", import.meta.url))

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        resolve: { alias: { "~": appDir } },
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/unit/setup.ts"],
        },
      },
      {
        resolve: { alias: { "~": appDir } },
        test: {
          name: "pbt",
          environment: "node",
          include: ["tests/pbt/**/*.test.{ts,tsx}"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/setup/global-setup.ts"],
          // Tests share one SeaweedFS instance; cluster-wide operations in one
          // file (quota enforcement, volume vacuum) must not race writes in
          // another.
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
})
