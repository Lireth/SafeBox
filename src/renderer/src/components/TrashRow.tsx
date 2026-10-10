import { useState } from 'react'
import { Icon } from './Icon'
import { getCategory } from '../lib/categories'
import { t, useLang } from '../lib/i18n'
import type { AccountEntry } from '../../../../shared/types'

/** 回收站保留时长（与主进程 vault.ts 的 TRASH_RETENTION_MS 保持一致） */
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

interface TrashRowProps {
  entry: AccountEntry
  isActive?: boolean
  onRestore: (entry: AccountEntry) => void
  onPurge: (entry: AccountEntry) => void
}

/** 计算剩余保留天数（向上取整，至少 1 天） */
function remainingDays(deletedAt: number, now: number): number {
  return Math.max(1, Math.ceil((deletedAt + TRASH_RETENTION_MS - now) / DAY_MS))
}

/** 回收站条目行：不可打开详情，仅提供恢复与彻底删除操作 */
export function TrashRow({ entry, isActive = false, onRestore, onPurge }: TrashRowProps): React.JSX.Element {
  useLang()
  // 挂载时刻的时间快照：剩余天数随时间流逝而减少，但行内展示取挂载时值即可
  const [now] = useState(() => Date.now())
  const category = getCategory(entry.category)
  const initial = entry.title.charAt(0).toUpperCase() || '?'
  const avatarColor = `hsl(${category.hue} 62% 52%)`

  return (
    <div className={`entry-row trash-row ${isActive ? 'is-active' : ''}`}>
      <div className="entry-avatar" style={{ background: avatarColor, filter: 'grayscale(0.6)', opacity: 0.75 }}>
        {initial}
      </div>

      <div className="entry-main">
        <div className="entry-title-line">
          <span className="entry-title">{entry.title}</span>
          <span className="entry-chip" style={{ color: `hsl(${category.hue} 45% 45%)` }}>
            {category.label}
          </span>
        </div>
        <div className="entry-sub">{t('trashRow.daysLeft', { days: remainingDays(entry.deletedAt ?? now, now) })}</div>
      </div>

      <div className="entry-actions trash-row-actions">
        <button
          type="button"
          className="icon-btn"
          title={t('trashRow.restore')}
          aria-label={`${t('trashRow.restore')} - ${entry.title}`}
          onClick={() => onRestore(entry)}
        >
          <Icon name="refresh" size={15} />
        </button>
        <button
          type="button"
          className="icon-btn trash-row-purge"
          title={t('trashRow.purge')}
          aria-label={`${t('trashRow.purge')} - ${entry.title}`}
          onClick={() => onPurge(entry)}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
    </div>
  )
}
