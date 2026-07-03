// Single ops pass. Normally invoked by ops-loop.ts inside the ops container;
// run manually with:
//   docker compose --env-file env.<env> --env-file .env run --rm ops \
//     node /kura/scripts/ops-daily.ts
// --now=<ISO 8601> overrides the current time (tests and manual recovery).
import { runDaily } from "./lib/daily.ts"

const parseNow = (argv: string[]): Date => {
  const arg = argv.find((a) => a.startsWith("--now="))
  if (arg === undefined) {
    return new Date()
  }
  const now = new Date(arg.slice("--now=".length))
  if (Number.isNaN(now.getTime())) {
    throw new Error(`invalid --now value: ${arg}`)
  }

  return now
}

await runDaily(parseNow(process.argv.slice(2)))
