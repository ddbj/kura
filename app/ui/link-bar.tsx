import { useState } from "react"

import { cn } from "./cn"
import { Icon } from "./icon"

type Props = {
  url: string
  tone?: "ok" | "warn"
  copyLabel: string
  copiedLabel: string
}

// Read-only copy bar: displays the URL and copies it on button click.
export const LinkBar = ({ url, tone = "ok", copyLabel, copiedLabel }: Props) => {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // fall back to selection
      const el = document.createElement("textarea")
      el.value = url
      document.body.appendChild(el)
      el.select()
      document.execCommand("copy")
      el.remove()
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }
  return (
    <div className={cn("linkbar", { warn: tone === "warn" })}>
      <div className="u" title={url}>{url}</div>
      <button type="button" className="cp" onClick={() => void onCopy()}>
        <Icon name="link" size={14} />
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  )
}
