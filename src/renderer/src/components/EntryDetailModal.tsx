import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { getCategory } from '../lib/categories'
import type { AccountEntry } from '../../../../electron/api'

interface EntryDetailModalProps {
  entry: AccountEntry
  onClose: () => void
  onEdit: (entry: AccountEntry) => void
  onDelete: (entry: AccountEntry) => void
  onToggleFavorite: (entry: AccountEntry) => void
  onCopy: (text: string, label: string) => void
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

export function EntryDetailModal({
  entry,
  onClose,
  onEdit,
  onDelete,
  onToggleFavorite,
  onCopy
}: EntryDetailModalProps): React.JSX.Element {
  const [showPassword, setShowPassword] = useState(false)

  // 切换查看对象时重置密码可见状态
  useEffect(() => setShowPassword(false), [entry.id])

  const category = getCategory(entry.category)
  const initial = entry.title.charAt(0).toUpperCase() || '?'
  const avatarColor = `hsl(${category.hue} 62% 52%)`

  return (
    <Modal wide onClose={onClose}>
      <div className="detail-header">
        <div className="entry-avatar lg" style={{ background: avatarColor }}>
          {initial}
        </div>
        <div className="detail-heading">
          <div className="detail-title-line">
            <h3 className="detail-title">{entry.title}</h3>
            <span className="entry-chip" style={{ color: `hsl(${category.hue} 45% 45%)` }}>
              {category.label}
            </span>
          </div>
          <p className="detail-meta">
            添加于 {formatTime(entry.createdAt)} · 更新于 {formatTime(entry.updatedAt)}
          </p>
        </div>
        <button
          type="button"
          className={`icon-btn ${entry.favorite ? 'is-fav' : ''}`}
          title={entry.favorite ? '取消收藏' : '收藏'}
          onClick={() => onToggleFavorite(entry)}
        >
          <Icon name="star" size={17} filled={entry.favorite} />
        </button>
      </div>

      <div className="detail-fields">
        <div className="detail-field">
          <span className="detail-label">用户名</span>
          <span className="detail-value">{entry.username || <em className="detail-empty">未设置</em>}</span>
          {entry.username && (
            <button type="button" className="icon-btn" title="复制用户名" onClick={() => onCopy(entry.username, '用户名已复制')}>
              <Icon name="copy" size={15} />
            </button>
          )}
        </div>

        <div className="detail-field">
          <span className="detail-label">密码</span>
          <span className="detail-value mono">
            {entry.password
              ? showPassword
                ? entry.password
                : '•'.repeat(Math.min(entry.password.length, 12))
              : <em className="detail-empty">未设置</em>}
          </span>
          {entry.password && (
            <>
              <button
                type="button"
                className="icon-btn"
                title={showPassword ? '隐藏密码' : '显示密码'}
                onClick={() => setShowPassword((v) => !v)}
              >
                <Icon name={showPassword ? 'eye-off' : 'eye'} size={15} />
              </button>
              <button type="button" className="icon-btn" title="复制密码" onClick={() => onCopy(entry.password, '密码已复制')}>
                <Icon name="copy" size={15} />
              </button>
            </>
          )}
        </div>

        <div className="detail-field">
          <span className="detail-label">网址</span>
          <span className="detail-value">{entry.url || <em className="detail-empty">未设置</em>}</span>
          {entry.url && (
            <button
              type="button"
              className="icon-btn"
              title="在浏览器中打开"
              onClick={() => void window.safebox.openExternal(entry.url)}
            >
              <Icon name="external" size={15} />
            </button>
          )}
        </div>

        {entry.notes && (
          <div className="detail-field top">
            <span className="detail-label">备注</span>
            <span className="detail-value prewrap">{entry.notes}</span>
          </div>
        )}
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost btn-danger-ghost" onClick={() => onDelete(entry)}>
          <Icon name="trash" size={15} />
          删除
        </button>
        <div className="modal-actions-right">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onEdit(entry)}>
            <Icon name="pencil" size={14} />
            编辑
          </button>
        </div>
      </div>
    </Modal>
  )
}
