import type { Lang } from "./lang"

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

// Format the calendar date in a fixed timezone (JST, BSI's locale and the
// offset the news timestamps carry) so the same instant renders the same day on
// the server (often UTC) and in the browser (any timezone) — reading local
// components would let a near-midnight timestamp render a different day on each
// side and trip a hydration mismatch.
export const formatDate = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // Shift the instant by +09:00 and read UTC components to get the JST wall-clock
  // date deterministically, without depending on the runtime timezone.
  const jst = new Date(d.getTime() + JST_OFFSET_MS)
  const y = jst.getUTCFullYear()
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0")
  const day = String(jst.getUTCDate()).padStart(2, "0")

  return `${y}/${m}/${day}`
}

// formatDate の lang 依存版。 ja は `YYYY/MM/DD`、 en は `YYYY-MM-DD` (en-CA)
// で表示する。 JST 固定なので hydration mismatch は同様に防止される。
export const formatDateLocalized = (iso: string, lang: Lang): string => {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  const locale = lang === "ja" ? "ja-JP" : "en-CA"

  return new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo",
  }).format(parsed)
}

// 日時 (分まで) の lang 依存表示。日付系と同じく JST 固定。
export const formatDateTimeLocalized = (date: Date, lang: Lang): string =>
  new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date)
