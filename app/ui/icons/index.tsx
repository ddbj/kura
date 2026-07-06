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

export const UploadIcon = ({ size = 16, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <path d="M12 16 V4" />
    <polyline points="7 9 12 4 17 9" />
    <path d="M4 16 v3 a2 2 0 0 0 2 2 H18 a2 2 0 0 0 2 -2 v-3" />
  </svg>
)

export const DownloadIcon = ({ size = 16, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <path d="M12 4 V16" />
    <polyline points="7 11 12 16 17 11" />
    <path d="M4 16 v3 a2 2 0 0 0 2 2 H18 a2 2 0 0 0 2 -2 v-3" />
  </svg>
)

export const LinkIcon = ({ size = 16, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <path d="M10 14 a4.2 4.2 0 0 0 6 0 l2.5 -2.5 a4.2 4.2 0 0 0 -6 -6 L11 6" />
    <path d="M14 10 a4.2 4.2 0 0 0 -6 0 L5.5 12.5 a4.2 4.2 0 0 0 6 6 L13 18" />
  </svg>
)

export const TrashIcon = ({ size = 16, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <path d="M4 7 H20" />
    <path d="M9 7 V4.5 a1 1 0 0 1 1 -1 H14 a1 1 0 0 1 1 1 V7" />
    <path d="M6 7 L7 19 a2 2 0 0 0 2 2 H15 a2 2 0 0 0 2 -2 L18 7" />
  </svg>
)

export const CheckCircleIcon = ({ size = 16, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="8 12.5 11 15.5 16 9" />
  </svg>
)
