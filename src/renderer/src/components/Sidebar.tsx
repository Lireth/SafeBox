import { useMemo } from 'react'
import { Icon } from './Icon'
import { CATEGORIES, type FilterId } from '../lib/categories'
import { t, useLang } from '../lib/i18n'
import type { AccountEntry } from '../../../../shared/types'

interface SidebarProps {
  /** 当前筛选下参与计数的条目（已排除回收站中的条目） */
  entries: AccountEntry[]
  /** 回收站中的条目数（导航计数展示） */
  trashCount: number
  filter: FilterId
  query: string
  pinEnabled: boolean
  onFilterChange: (filter: FilterId) => void
  onQueryChange: (query: string) => void
  onAdd: () => void
  /** 立即锁定（已启用 PIN 时显示） */
  onLock: () => void
  /** 打开锁定 PIN 设置弹窗（未启用时显示） */
  onSetupPin: () => void
  /** 打开备份与恢复弹窗 */
  onBackup: () => void
  /** 打开安全体检面板 */
  onAudit: () => void
  /** 打开设置弹窗 */
  onSettings: () => void
}

export function Sidebar({
  entries,
  trashCount,
  filter,
  query,
  pinEnabled,
  onFilterChange,
  onQueryChange,
  onAdd,
  onLock,
  onSetupPin,
  onBackup,
  onAudit,
  onSettings,
}: SidebarProps): React.JSX.Element {
  useLang()
  // 清除按钮直接从 query 派生（O22）：父层程序化清空搜索（如 Esc 快捷键）时按钮同步消失，
  // 独立 state 会在该场景残留（曾为已知失同步缺陷）
  const showClear = query.length > 0

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: entries.length, favorite: 0 }
    for (const entry of entries) {
      result[entry.category] = (result[entry.category] ?? 0) + 1
      if (entry.favorite) result.favorite++
    }
    return result
  }, [entries])

  function handleSearch(value: string): void {
    onQueryChange(value)
  }

  const renderItem = (id: FilterId, label: string, icon: React.ReactNode, count: number): React.JSX.Element => (
    <button
      key={id}
      type="button"
      className={`nav-item ${filter === id ? 'active' : ''}`}
      onClick={() => onFilterChange(id)}
    >
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      <span className="nav-count">{count}</span>
    </button>
  )

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">
          <Icon name="shield" size={20} strokeWidth={2} />
        </div>
        <div className="brand-text">
          <span className="brand-name">{t('brand.name')}</span>
          <span className="brand-tag">{t('brand.tag')}</span>
        </div>
      </div>

      <div className="search-box">
        <Icon name="search" size={15} className="search-icon" />
        <input
          id="search-input"
          type="text"
          className="search-input"
          placeholder={t('sidebar.searchPlaceholder')}
          aria-label={t('sidebar.searchPlaceholder')}
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
        />
        {showClear && (
          <button type="button" className="search-clear" aria-label={t('sidebar.clearSearch')} onClick={() => handleSearch('')}>
            <Icon name="x" size={13} />
          </button>
        )}
      </div>

      <nav className="nav">
        {renderItem('all', t('sidebar.allAccounts'), <Icon name="grid" size={16} />, counts.all)}
        {renderItem('favorite', t('sidebar.favorites'), <Icon name="star" size={16} filled />, counts.favorite)}
        {renderItem('trash', t('sidebar.trash'), <Icon name="trash" size={16} />, trashCount)}
        <div className="nav-divider">{t('sidebar.categoryDivider')}</div>
        {CATEGORIES.map((cat) =>
          renderItem(
            cat.id,
            cat.label,
            <Icon name={cat.icon} size={16} style={{ color: `hsl(${cat.hue} 62% 58%)` }} />,
            counts[cat.id] ?? 0,
          ),
        )}
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="btn btn-ghost btn-block" onClick={onAdd}>
          <Icon name="plus" size={16} />
          {t('sidebar.addAccount')}
        </button>
        {pinEnabled ? (
          <button type="button" className="btn btn-ghost btn-block lock-btn" onClick={onLock} title="Ctrl+L">
            <Icon name="lock" size={15} />
            {t('sidebar.lockNow')}
          </button>
        ) : (
          <button type="button" className="btn btn-ghost btn-block lock-btn" onClick={onSetupPin}>
            <Icon name="key" size={15} />
            {t('sidebar.setupLock')}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-block lock-btn" onClick={onBackup}>
          <Icon name="archive" size={15} />
          {t('sidebar.backup')}
        </button>
        <button type="button" className="btn btn-ghost btn-block lock-btn" onClick={onAudit}>
          <Icon name="shield" size={15} />
          {t('sidebar.audit')}
        </button>
        <button type="button" className="btn btn-ghost btn-block lock-btn" onClick={onSettings}>
          <Icon name="settings" size={15} />
          {t('sidebar.settings')}
        </button>
      </div>
    </aside>
  )
}
