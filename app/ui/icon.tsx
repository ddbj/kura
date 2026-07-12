import type { CSSProperties } from "react"

export type IconName =
  | "file"
  | "folder"
  | "dl"
  | "up"
  | "caret"
  | "search"
  | "globe"
  | "user"
  | "check"
  | "link"
  | "sort"
  | "more"
  | "trash"
  | "clock"

type IconProps = {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
  ariaLabel?: string
}

export const Icon = ({ name, size = 16, className, style, ariaLabel }: IconProps) => (
  <svg
    width={size}
    height={size}
    className={className}
    style={style}
    aria-hidden={ariaLabel === undefined ? true : undefined}
    aria-label={ariaLabel}
    role={ariaLabel === undefined ? undefined : "img"}
  >
    <use href={`#i-${name}`} />
  </svg>
)

export const IconSprite = () => (
  <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
    <symbol id="i-file" viewBox="0 0 20 20">
      <path d="M5 2.5h6l4 4v11c0 .3-.2.5-.5.5h-9c-.3 0-.5-.2-.5-.5v-15z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M11 2.5v4h4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </symbol>
    <symbol id="i-folder" viewBox="0 0 20 20">
      <path d="M2.5 5.5c0-.7.6-1.3 1.3-1.3h3.4l1.5 1.6h6.5c.7 0 1.3.6 1.3 1.3v7c0 .7-.6 1.3-1.3 1.3H3.8c-.7 0-1.3-.6-1.3-1.3v-8.6z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </symbol>
    <symbol id="i-dl" viewBox="0 0 16 16">
      <path d="M8 3v7M8 10L5.2 7.2M8 10l2.8-2.8M3 12.8h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </symbol>
    <symbol id="i-up" viewBox="0 0 16 16">
      <path d="M8 11V3M8 3L4.8 6.2M8 3l3.2 3.2M3 12.8h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </symbol>
    <symbol id="i-caret" viewBox="0 0 12 12">
      <path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </symbol>
    <symbol id="i-search" viewBox="0 0 16 16">
      <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </symbol>
    <symbol id="i-globe" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.6 8h12.8M8 1.6c1.8 1.8 2.7 4 2.7 6.4S9.8 12.6 8 14.4C6.2 12.6 5.3 10.4 5.3 8S6.2 3.4 8 1.6z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </symbol>
    <symbol id="i-user" viewBox="0 0 16 16">
      <circle cx="8" cy="5.2" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.8 13.4c0-2.7 2.3-4.4 5.2-4.4s5.2 1.7 5.2 4.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </symbol>
    <symbol id="i-check" viewBox="0 0 16 16">
      <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </symbol>
    <symbol id="i-link" viewBox="0 0 16 16">
      <path d="M6.5 9.5l3-3M7 4.5l.9-.9a2.6 2.6 0 013.7 3.7l-.9.9M9 11.5l-.9.9a2.6 2.6 0 01-3.7-3.7l.9-.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </symbol>
    <symbol id="i-sort" viewBox="0 0 12 12">
      <path d="M6 2.5v7M6 9.5L3.8 7.3M6 9.5l2.2-2.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </symbol>
    <symbol id="i-more" viewBox="0 0 16 16">
      <circle cx="8" cy="3.4" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="12.6" r="1.4" fill="currentColor" />
    </symbol>
    <symbol id="i-trash" viewBox="0 0 16 16">
      <path d="M3.4 4.6h9.2M6.4 4.6V3.2h3.2v1.4M4.7 4.6l.6 8.2h5.4l.6-8.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </symbol>
    <symbol id="i-clock" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.6V8l2.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </symbol>
  </svg>
)
