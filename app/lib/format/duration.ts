import type { TFn } from "~/lib/i18n"

const MINUTES_PER_HOUR = 60

// Coarse human duration for "expires in ..." copy: hours + minutes, dropping
// the minutes part when it lands exactly on the hour. Sub-minute rounds up to
// one minute so a link never reads as already expired while it still works.
export const formatDuration = (totalMinutes: number, t: TFn): string => {
  const minutes = Math.max(0, Math.round(totalMinutes))
  if (minutes < 1) return t("duration.lessThanMinute")
  if (minutes < MINUTES_PER_HOUR) return t("duration.minutes", { minutes })
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  const rest = minutes % MINUTES_PER_HOUR
  if (rest === 0) return t("duration.hours", { hours })

  return t("duration.hoursMinutes", { hours, minutes: rest })
}
