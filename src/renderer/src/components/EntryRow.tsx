import { Icon } from './Icon'
import { getCategory } from '../lib/categories'
import { t, useLang } from '../lib/i18n'
import type { AccountEntry } from '../../../../shared/types'

interface EntryRowProps {
  entry: AccountEntry
  /** 键盘导航当前选中（高亮显示） */
  isActive?: boolean
  onOpen: (entry: AccountEntry) => void
  onToggleFavorite: (entry: AccountEntry) => void
  onCopy: (text: string, label: string) => void
}

function maskPassword(password: string): string {
  if (!password) return t('common.notSet')
  return '•'.repeat(Math.min(password.length, 12))
}

export function EntryRow({
  entry,
  isActive = false,
  onOpen,
  onToggleFavorite,
  onCopy,
}: EntryRowProps): React.JSX.Element {
  useLang()
  const category = getCategory(entry.category)
  const initial = entry.title.charAt(0).toUpperCase() || '?'
  const avatarColor = `hsl(${category.hue} 62% 52%)`

  return (
    <div
      className={`entry-row ${isActive ? 'is-active' : ''}`}
      onClick={() => onOpen(entry)}
      role="button"
      tabIndex={0}
      aria-label={entry.title}
      onKeyDown={(e) => {
        // role=button 的键盘语义：Enter 与 Space 均触发（Space 需阻止默认滚动）
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(entry)
        }
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
        <div className="entry-sub">{entry.username ? entry.username : maskPassword(entry.password)}</div>
      </div>

      <div className="entry-actions" onClick={(e) => e.stopPropagation()}>
        {entry.username && (
          <button
            type="button"
            className="icon-btn"
            title={t('entryRow.copyUser')}
            aria-label={`${t('entryRow.copyUser')} - ${entry.title}`}
            onClick={() => onCopy(entry.username, t('entryRow.userCopied'))}
          >
            <Icon name="copy" size={15} />
          </button>
        )}
        {entry.password && (
          <button
            type="button"
            className="icon-btn"
            title={t('entryRow.copyPass')}
            aria-label={`${t('entryRow.copyPass')} - ${entry.title}`}
            onClick={() => onCopy(entry.password, t('entryRow.passCopied'))}
          >
            <Icon name="key" size={15} />
          </button>
        )}
        <button
          type="button"
          className={`icon-btn ${entry.favorite ? 'is-fav' : ''}`}
          title={entry.favorite ? t('entryRow.unfavorite') : t('entryRow.favorite')}
          aria-label={`${entry.favorite ? t('entryRow.unfavorite') : t('entryRow.favorite')} - ${entry.title}`}
          onClick={() => onToggleFavorite(entry)}
        >
          <Icon name="star" size={15} filled={entry.favorite} />
        </button>
      </div>
    </div>
  )
}
