import { Icon } from './Icon'
import { getCategory } from '../lib/categories'
import type { AccountEntry } from '../../../../shared/types'

interface EntryRowProps {
  entry: AccountEntry
  onOpen: (entry: AccountEntry) => void
  onToggleFavorite: (entry: AccountEntry) => void
  onCopy: (text: string, label: string) => void
}

function maskPassword(password: string): string {
  if (!password) return '未设置'
  return '•'.repeat(Math.min(password.length, 12))
}

export function EntryRow({ entry, onOpen, onToggleFavorite, onCopy }: EntryRowProps): React.JSX.Element {
  const category = getCategory(entry.category)
  const initial = entry.title.charAt(0).toUpperCase() || '?'
  const avatarColor = `hsl(${category.hue} 62% 52%)`

  return (
    <div className="entry-row" onClick={() => onOpen(entry)} role="button" tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(entry)
      }}
    >
      <div className="entry-avatar" style={{ background: avatarColor }}>
        {entry.favorite && <Icon name="star" size={10} filled className="entry-fav-dot" />}
        {initial}
      </div>

      <div className="entry-main">
        <div className="entry-title-line">
          <span className="entry-title">{entry.title}</span>
          <span className="entry-chip" style={{ color: `hsl(${category.hue} 45% 45%)` }}>
            {category.label}
          </span>
        </div>
        <div className="entry-sub">
          {entry.username ? entry.username : maskPassword(entry.password)}
        </div>
      </div>

      <div className="entry-actions" onClick={(e) => e.stopPropagation()}>
        {entry.username && (
          <button type="button" className="icon-btn" title="复制用户名" onClick={() => onCopy(entry.username, '用户名已复制')}>
            <Icon name="copy" size={15} />
          </button>
        )}
        {entry.password && (
          <button type="button" className="icon-btn" title="复制密码" onClick={() => onCopy(entry.password, '密码已复制')}>
            <Icon name="key" size={15} />
          </button>
        )}
        <button
          type="button"
          className={`icon-btn ${entry.favorite ? 'is-fav' : ''}`}
          title={entry.favorite ? '取消收藏' : '收藏'}
          onClick={() => onToggleFavorite(entry)}
        >
          <Icon name="star" size={15} filled={entry.favorite} />
        </button>
      </div>
    </div>
  )
}
