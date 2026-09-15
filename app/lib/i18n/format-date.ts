import type { Lang } from "./lang"

// presign の失効時刻。ja は `YYYY/MM/DD`、en は `YYYY-MM-DD` (en-CA)。
// timeZone を指定しないので一覧の更新日時と同じくブラウザのタイムゾーンで出る。
// 画面の中で時刻の基準が 2 つあると読み違えるため、どちらも揃える。
export const formatDateTimeLocalized = (date: Date, lang: Lang): string =>
  new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date)

// 一覧の行に出す更新日時。今年のものは月日だけ、別の年のものは年も添える
// (年跨ぎの項目が同じ「09/14」に見えてしまうのを防ぐ)。日付と時刻を別々に
// 整形して連結するのは、locale によっては両者の間にカンマが入るため。
// timeZone を指定しないので、閲覧しているブラウザのタイムゾーンで出る。
export const formatListDateTime = (date: Date, lang: Lang, now: Date = new Date()): string => {
  const locale = lang === "ja" ? "ja-JP" : "en-CA"
  const sameYear = date.getFullYear() === now.getFullYear()
  const dateOptions: Intl.DateTimeFormatOptions = sameYear
    ? { month: "2-digit", day: "2-digit" }
    : { year: "numeric", month: "2-digit", day: "2-digit" }
  const day = new Intl.DateTimeFormat(locale, dateOptions).format(date)
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)

  return `${day} ${time}`
}
