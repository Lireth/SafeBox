import type { CSSProperties, ReactNode } from 'react'
import { getCategory } from '../lib/categories'

interface EntryAvatarProps {
  /** 条目名称（取首字符做大写头像字） */
  title: string
  /** 分类 id（决定头像色相） */
  category: string
  /** 尺寸类：sm（审计列表）/ lg（详情头部），缺省为列表行默认尺寸 */
  size?: 'sm' | 'lg'
  /** 附加样式（如回收站置灰 filter/opacity） */
  style?: CSSProperties
  /** 叠加元素（如列表行的收藏星标角标） */
  children?: ReactNode
}

/**
 * 条目头像（O25 收编）：首字母 + 分类色相底色。
 * 此前在 EntryRow / TrashRow / EntryDetailModal / AuditModal 四处重复计算
 * initial 与 hsl 颜色，统一出口。渲染 span（display: flex 与标签无关，
 * 且在 <button> 内嵌套合法——审计列表头像位于按钮内）。
 */
export function EntryAvatar({ title, category, size, style, children }: EntryAvatarProps): React.JSX.Element {
  const hue = getCategory(category).hue
  const initial = title.charAt(0).toUpperCase() || '?'
  return (
    <span
      className={['entry-avatar', size].filter(Boolean).join(' ')}
      style={{ background: `hsl(${hue} 62% 52%)`, ...style }}
    >
      {children}
      {initial}
    </span>
  )
}
