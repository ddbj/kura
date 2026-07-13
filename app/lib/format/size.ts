// Binary-prefixed byte formatter (KiB/MiB/GiB/TiB). Used where the underlying
// value is a strict IEC size (upload progress totals from lib-storage).
export const formatSize = (bytes: number): string => {
  let value = bytes
  let unit = "B"
  for (const next of ["KiB", "MiB", "GiB", "TiB"]) {
    if (value < 1024) break
    value /= 1024
    unit = next
  }
  if (unit === "B") return `${value} B`
  return `${value >= 100 ? String(Math.round(value)) : value.toFixed(1)} ${unit}`
}
