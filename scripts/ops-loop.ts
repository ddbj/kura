// Entry point of the ops service (compose.yml): one daily pass immediately,
// then every KURA_OPS_INTERVAL_SECONDS. A failed pass retries after a short
// backoff instead of waiting out the full interval.
import { setTimeout as sleep } from "node:timers/promises"

import { runDaily } from "./lib/daily.ts"

const intervalSeconds = Number(process.env["KURA_OPS_INTERVAL_SECONDS"] ?? "") || 86400
const RETRY_BACKOFF_SECONDS = 300

for (;;) {
  let waitSeconds = intervalSeconds
  try {
    await runDaily(new Date())
  } catch (err) {
    console.error("kura-ops: daily pass failed:", err)
    waitSeconds = Math.min(intervalSeconds, RETRY_BACKOFF_SECONDS)
  }
  await sleep(waitSeconds * 1000)
}
