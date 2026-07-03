// Entry point of the ops service (compose.yml): one daily pass immediately,
// then every KURA_OPS_INTERVAL_SECONDS. A failed pass is logged and retried
// on the next tick.
import { setTimeout as sleep } from "node:timers/promises"

import { runDaily } from "./lib/daily.ts"

const intervalSeconds = Number(process.env["KURA_OPS_INTERVAL_SECONDS"] ?? "") || 86400

for (;;) {
  try {
    await runDaily(new Date())
  } catch (err) {
    console.error("kura-ops: daily pass failed:", err)
  }
  await sleep(intervalSeconds * 1000)
}
