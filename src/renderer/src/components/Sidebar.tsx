import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import { CATEGORIES, type FilterId } from '../lib/categories'
import type { AccountEntry } from '../../../../shared/types'

interface SidebarProps {
  entries: AccountEntry[]
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
}

export function Sidebar({
  entries,
  filter,
  query,
  pinEnabled,
  onFilterChange,
  onQueryChange,
  onAdd,
  onLock,
  onSetupPin,
  onBackup,
  onAudit
}: SidebarProps): React.JSX.Element {
  const [showClear, setShowClear] = useState(false)

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
    setShowClear(value.length > 0)
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
          <span className="brand-name">秘匣</span>
          <span className="brand-tag">账号密码保险箱</span>
        </div>
      </div>

      <div className="search-box">
        <Icon name="search" size={15} className="search-icon" />
        <input
          type="text"
          className="search-input"
          placeholder="搜索名称、用户名、网址…"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
        />
        {showClear && (
          <button type="button" className="search-clear" aria-label="清空搜索" onClick={() => handleSearch('')}>
            <Icon name="x" size={13} />
          </button>
        )}
      </div>

      <nav className="nav">
        {renderItem('all', '全部账号', <Icon name="grid" size={16} />, counts.all)}
        {renderItem('favorite', '收藏', <Icon name="star" size={16} filled />, counts.favorite)}
        <div className="nav-divider">分类</div>
        {CATEGORIES.map((cat) =>
          renderItem(
            cat.id,
            cat.label,
            <Icon name={cat.icon} size={16} style={{ color: `hsl(${cat.hue} 62% 58%)` }} />,
            counts[cat.id] ?? 0
          )
        )}
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="btn btn-ghost btn-block" onClick={onAdd}>
          <Icon name="plus" size={16} />
          添加账号
        </button>
        {pinEnabled ? (
          <button type="button" className="btn btn-ghost btn-block lock-btn" onClick={onLock} title="Ctrl+L">
            <Icon name="lock" size={15} />
            立即锁定
          </button>
        ) : (
          <button type="button" className="btn btn-ghost btn-block lock-btn" onClick={onSetupPin}>
            <Icon name="key" size={15} />
            设置锁定
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-block lock-btn" onClick={onBackup}>
          <Icon name="archive" size={15} />
          备份与恢复
        </button>
        <button type="button" className="btn btn-ghost btn-block lock-btn" onClick={onAudit}>
          <Icon name="shield" size={15} />
          安全体检
        </button>
      </div>
    </aside>
  )
}
