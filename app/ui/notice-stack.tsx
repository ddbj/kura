import { Children, type ReactNode } from "react"

type Props = {
  children: ReactNode
}

// Header 直下 (`.wrap` の冒頭) に置くページレベル通知の縦積み。中の
// Callout / .banner を一箇所にまとめ、ページごとに配置がばらつかないよう
// にする。表示すべき子が 1 つも無い場合は自身を出さず、直後の pathbar が
// 上に詰まるようにする (CSS 側の `:empty` は保険)。
export const NoticeStack = ({ children }: Props) => {
  // Children.toArray は null / undefined / boolean を既に除外する。
  const items = Children.toArray(children)
  if (items.length === 0) return null

  return <div className="notices">{items}</div>
}
