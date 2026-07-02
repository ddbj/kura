type ClassValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>

export const cn = (...inputs: ClassValue[]): string => {
  const out: string[] = []

  const push = (value: ClassValue): void => {
    if (value === null || value === undefined || value === false || value === true) return
    if (Array.isArray(value)) {
      for (const item of value) push(item)
      return
    }
    if (typeof value === "object") {
      for (const [key, on] of Object.entries(value)) {
        if (on) out.push(key.trim())
      }
      return
    }
    const s = String(value).trim()
    if (s) out.push(s)
  }

  for (const input of inputs) push(input)
  return out.join(" ")
}
