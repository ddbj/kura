import type { SVGProps } from "react"

type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill" | "stroke"> & {
  size?: number
  title?: string
}

const baseProps = (size: number, title: string | undefined): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": title === undefined,
  role: title === undefined ? "presentation" : "img",
  "aria-label": title,
  focusable: false,
})

export const ChevronDownIcon = ({ size = 14, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

export const CloseIcon = ({ size = 14, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
)

export const GlobeIcon = ({ size = 14, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <circle cx="12" cy="12" r="9" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <path d="M12 3 a12 12 0 0 1 0 18 a12 12 0 0 1 0 -18 z" />
  </svg>
)

export const ExternalIcon = ({ size = 12, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <path d="M14 4 H20 V10" />
    <line x1="20" y1="4" x2="11" y2="13" />
    <path d="M18 14 V18 a2 2 0 0 1 -2 2 H6 a2 2 0 0 1 -2 -2 V8 a2 2 0 0 1 2 -2 H10" />
  </svg>
)

export const FolderIcon = ({ size = 16, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <path d="M3 7 a2 2 0 0 1 2 -2 H9 l2 2 H19 a2 2 0 0 1 2 2 V18 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2 -2 Z" />
  </svg>
)
