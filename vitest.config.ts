import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/setup/global-setup.ts"],
    // Tests share one SeaweedFS instance; cluster-wide operations in one file
    // (quota enforcement, volume vacuum) must not race writes in another.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000,
    passWithNoTests: true,
  },
})
