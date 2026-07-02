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

export const SearchIcon = ({ size = 16, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <circle cx="11" cy="11" r="7" />
    <line x1="20" y1="20" x2="16.65" y2="16.65" />
  </svg>
)

export const GlobeIcon = ({ size = 14, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <circle cx="12" cy="12" r="9" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <path d="M12 3 a12 12 0 0 1 0 18 a12 12 0 0 1 0 -18 z" />
  </svg>
)

export const UserIcon = ({ size = 14, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21 a8 8 0 0 1 16 0" />
  </svg>
)

export const ExternalIcon = ({ size = 12, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <path d="M14 4 H20 V10" />
    <line x1="20" y1="4" x2="11" y2="13" />
    <path d="M18 14 V18 a2 2 0 0 1 -2 2 H6 a2 2 0 0 1 -2 -2 V8 a2 2 0 0 1 2 -2 H10" />
  </svg>
)

export const InfoIcon = ({ size = 14, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="11" x2="12" y2="17" />
    <circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
  </svg>
)

export const AlertIcon = ({ size = 16, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <path d="M12 4 L21 19.5 H3 Z" />
    <line x1="12" y1="10" x2="12" y2="14" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

export const CheckIcon = ({ size = 16, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <polyline points="4 12 9.5 17.5 20 6.5" />
  </svg>
)

export const HelpIcon = ({ size = 14, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

export const LockClosedIcon = ({ size = 14, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" fill="currentColor" stroke="none" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

export const LockOpenIcon = ({ size = 14, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0" />
  </svg>
)

export const ArrowLeftIcon = ({ size = 14, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <line x1="20" y1="12" x2="4" y2="12" />
    <polyline points="11 5 4 12 11 19" />
  </svg>
)

export const MenuIcon = ({ size = 16, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
)

// docs hub のアイコン群。共通 UI アイコン (Chevron / Search 等) と同じ
// viewBox 24x24 + stroke 1.75 outline + currentColor に揃える。size 16-18 でも
// 線質が安定する。handoff の「folder ノッチ / doc 折り返し / ハッチ 4 本」 意図は維持。
export const FolderIcon = ({ size = 16, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <path d="M3 7 a2 2 0 0 1 2 -2 H9 l2 2 H19 a2 2 0 0 1 2 2 V18 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2 -2 Z" />
  </svg>
)

export const FileTextIcon = ({ size = 16, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <path d="M14 3 H6 a2 2 0 0 0 -2 2 V19 a2 2 0 0 0 2 2 H18 a2 2 0 0 0 2 -2 V9 L14 3 Z" />
    <polyline points="14 3 14 9 20 9" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="15" y2="17" />
  </svg>
)

export const HashIcon = ({ size = 13, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} {...rest}>
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="4" y1="15" x2="20" y2="15" />
    <line x1="10" y1="3" x2="8" y2="21" />
    <line x1="16" y1="3" x2="14" y2="21" />
  </svg>
)

// simple-icons の GitHub mark。 他の icon は stroke outline だが brand mark
// は filled silhouette が正なので fill/stroke を上書きする。
export const GitHubIcon = ({ size = 16, title, ...rest }: IconProps) => (
  <svg {...baseProps(size, title)} fill="currentColor" stroke="none" {...rest}>
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.69-3.88-1.54-3.88-1.54-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.89-.39.98 0 1.97.13 2.89.39 2.21-1.49 3.18-1.18 3.18-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.4-5.27 5.69.41.35.78 1.03.78 2.08 0 1.5-.01 2.71-.01 3.08 0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
  </svg>
)
