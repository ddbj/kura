// Human-friendly byte formatter (B / KB / MB / GB / TB) using the same 1024
// stepping as S3 / UI conventions. Single source across the browse UI so file
// sizes never disagree between the list, the modals, and the upload card.
// digits controls the fraction shown for values below 10 in their unit; values
// at or above 10 are rounded to an integer, and TB always uses two digits.
export const formatBytes = (n: number, digits = 1): string => {
  if (!Number.isFinite(n) || n < 0) return "—"
  if (n < 1024) return `${n} B`
  const k = n / 1024
  if (k < 1024) return `${k.toFixed(k < 10 ? digits : 0)} KB`
  const m = k / 1024
  if (m < 1024) return `${m.toFixed(m < 10 ? digits : 0)} MB`
  const g = m / 1024
  if (g < 1024) return `${g.toFixed(g < 10 ? digits : 0)} GB`
  const t = g / 1024

  return `${t.toFixed(2)} TB`
}
