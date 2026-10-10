import { useState } from 'react'
import { Icon } from './Icon'
import { formatDateTime, maskPassword } from '../lib/format'
import { useAutoHide } from '../lib/useAutoHide'
import { t, useLang } from '../lib/i18n'
import type { PasswordHistoryItem } from '../../../../shared/types'

/** 历史密码折叠区：默认收起，展开后逐条「显示/隐藏 + 复制」（单条独立超时隐藏） */
export function PasswordHistorySection({
  items,
  onCopy,
}: {
  items: PasswordHistoryItem[]
  onCopy: (text: string, label: string) => void
}): React.JSX.Element {
  useLang()
  const [open, setOpen] = useState(false)
  return (
    <div className="history-section">
      <button type="button" className="text-btn" onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'eye-off' : 'clock'} size={13} />
        {open ? t('detail.historyCollapse') : t('detail.historyToggle', { count: items.length })}
      </button>
      {open && (
        <div className="history-list">
          {items.map((item, index) => (
            <HistoryRow key={`${item.changedAt}-${index}`} item={item} onCopy={onCopy} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 单条历史密码行：默认掩码，点击显示 15 秒后自动隐藏 */
function HistoryRow({
  item,
  onCopy,
}: {
  item: PasswordHistoryItem
  onCopy: (text: string, label: string) => void
}): React.JSX.Element {
  useLang()
  const reveal = useAutoHide()
  return (
    <div className="history-row">
      <span className="history-time">{formatDateTime(item.changedAt)}</span>
      <span className="detail-value mono">{reveal.visible ? item.password : maskPassword(item.password)}</span>
      <button
        type="button"
        className="icon-btn"
        title={reveal.visible ? t('common.hide') : t('detail.show15')}
        onClick={reveal.toggle}
      >
        <Icon name={reveal.visible ? 'eye-off' : 'eye'} size={14} />
      </button>
      <button type="button" className="icon-btn" title={t('common.copy')} onClick={() => onCopy(item.password, t('detail.historyCopied'))}>
        <Icon name="copy" size={14} />
      </button>
    </div>
  )
}
