import { cn } from "./cn"

type LoadingViewProps = {
  label: string
  sublabel?: string
  full?: boolean
  brand?: boolean
}

export const LoadingView = ({ label, sublabel, full, brand }: LoadingViewProps) => (
  <div className={cn("loading", full === true && "full")} role="status" aria-live="polite">
    {brand === true && <span className="lmark" aria-hidden="true">kura</span>}
    <span className="lspin" aria-hidden="true">
      <span className="ldot" />
      <span className="ldot" />
      <span className="ldot" />
    </span>
    <span className="llabel">{label}</span>
    {sublabel !== undefined && <span className="lsub">{sublabel}</span>}
  </div>
)
