export const DAY_MS = 24 * 60 * 60 * 1000

// Shared age rule for ops tasks. The file-TTL variant matches the SPA expiry
// display (LastModified + N days).
export const isOlderThanDays = (date: Date, days: number, now: Date): boolean =>
  date.getTime() + days * DAY_MS <= now.getTime()
