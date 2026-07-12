import type { ButtonHTMLAttributes } from "react"

import { cn } from "./cn"
import type { IconName } from "./icon"
import { Icon } from "./icon"

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children"> & {
  icon: IconName
  ariaLabel: string
  active?: boolean
  size?: number
}

export const IconButton = ({ icon, ariaLabel, active, size = 16, className, ...rest }: Props) => (
  <button
    type="button"
    aria-label={ariaLabel}
    className={cn("iconbtn", { on: active === true }, className)}
    {...rest}
  >
    <Icon name={icon} size={size} />
  </button>
)
