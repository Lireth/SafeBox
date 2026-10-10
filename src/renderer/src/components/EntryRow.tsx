import { memo } from 'react'
import { Icon } from './Icon'
import { EntryAvatar } from './EntryAvatar'
import { getCategory } from '../lib/categories'
import { maskPassword } from '../lib/format'
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

/** 副行展示：优先用户名，无用户名时展示密码掩码 */
function entrySubtitle(entry: AccountEntry): string {
  if (entry.username) return entry.username
  return entry.password ? maskPassword(entry.password) : t('common.notSet')
}

/**
 * 账号列表行（O23：React.memo 包裹）。
 * 列表渲染时未变更条目的 entry 引用不变、回调由 App 层 useCallback 稳定，
 * 箭头导航（isActive 变化）或搜索输入重渲染列表时其余行直接跳过。
 */
function EntryRowBase({
  entry,
  isActive = false,
  onOpen,
  onToggleFavorite,
  onCopy,
}: EntryRowProps): React.JSX.Element {
  useLang()
  const category = getCategory(entry.category)

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
      <EntryAvatar title={entry.title} category={entry.category}>
        {entry.favorite && <Icon name="star" size={10} filled className="entry-fav-dot" />}
      </EntryAvatar>

      <div className="entry-main">
        <div className="entry-title-line">
          <span className="entry-title">{entry.title}</span>
          <span className="entry-chip" style={{ color: `hsl(${category.hue} 45% 45%)` }}>
            {category.label}
          </span>
        </div>
        <div className="entry-sub">{entrySubtitle(entry)}</div>
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

export const EntryRow = memo(EntryRowBase)
