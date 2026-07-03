import { readFileSync } from "node:fs"

import { defineConfig, devices } from "@playwright/test"

// E2E は起動済みの dev compose (nginx :28080) + DDBJ staging Keycloak を使う
// (docs/testing.md)。テストユーザーの資格情報は gitignored の .env から読む。
const readEnvFile = (path: string): Record<string, string> => {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return {}
  }
  const entries = text
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=")

      return [line.slice(0, idx), line.slice(idx + 1)] as const
    })

  return Object.fromEntries(entries)
}

const dotenv = readEnvFile(new URL(".env", import.meta.url).pathname)
for (const [key, value] of Object.entries(dotenv)) {
  process.env[key] ??= value
}

export default defineConfig({
  testDir: "tests/e2e",
  // 全テストが同じテストユーザー (= 同じ bucket) を使うため直列に走らせる
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: process.env["KURA_E2E_BASE_URL"] ?? "http://localhost:28080",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
})
