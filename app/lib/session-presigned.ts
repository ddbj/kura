// SPA-local record of presigned URLs issued in this browser session. The S3
// side keeps no trace of a presign, so the "期限つき" lens (design_handoff #1)
// is populated from this store. Cleared on page reload — matching the
// per-session promise made by the UI.
//
// Trust boundary: sessionStorage under a same-origin XSS is exposed. The
// stored `url` includes the SigV4 signature and STS session token; treat this
// as short-lived material that must never be read into the DOM without the
// same trust as the current STS session (i.e. render only for the owner). Do
// not persist beyond sessionStorage and do not migrate to localStorage. If
// the sensitivity envelope tightens, drop `url` from the schema and rebuild
// the display URL on demand with a fresh STS + presign.

const STORAGE_KEY = "kura.presigned"

export type SessionPresigned = {
  bucket: string
  key: string
  url: string
  method: "GET" | "PUT"
  expiresAt: number
}

const read = (): SessionPresigned[] => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.filter((e): e is SessionPresigned =>
      typeof e === "object" && e !== null &&
      "bucket" in e && typeof (e as { bucket: unknown }).bucket === "string" &&
      "key" in e && typeof (e as { key: unknown }).key === "string" &&
      "url" in e && typeof (e as { url: unknown }).url === "string" &&
      "method" in e && ((e as { method: unknown }).method === "GET" || (e as { method: unknown }).method === "PUT") &&
      "expiresAt" in e && typeof (e as { expiresAt: unknown }).expiresAt === "number",
    )
  } catch {
    return []
  }
}

const write = (entries: SessionPresigned[]) => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // sessionStorage full or unavailable — silent
  }
}

export const addSessionPresigned = (entry: SessionPresigned): void => {
  const now = Date.now()
  const kept = read().filter((e) => e.expiresAt > now && !(e.bucket === entry.bucket && e.key === entry.key))
  write([...kept, entry])
}

export const listSessionPresigned = (bucket: string): SessionPresigned[] => {
  const now = Date.now()

  return read().filter((e) => e.bucket === bucket && e.expiresAt > now)
}

export const dropSessionPresigned = (bucket: string, key: string): void => {
  const now = Date.now()
  const kept = read().filter((e) => e.expiresAt > now && !(e.bucket === bucket && e.key === key))
  write(kept)
}
