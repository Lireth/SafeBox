import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { getCategory } from '../lib/categories'
import { TOTP_DIGITS, TOTP_PERIOD_SECONDS, totpCode, totpRemainingSeconds } from '../lib/totp'
import { t, useLang } from '../lib/i18n'
import type { AccountEntry, PasswordHistoryItem } from '../../../../shared/types'

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

/** 密码明文可见时长（毫秒），到期自动隐藏；与剪贴板 30 秒清空同属「限时暴露」模型（issue #26） */
const PASSWORD_VISIBLE_MS = 15_000

export function EntryDetailModal({
  entry,
  onClose,
  onEdit,
  onDelete,
  onToggleFavorite,
  onCopy,
}: EntryDetailModalProps): React.JSX.Element {
  useLang()
  const [showPassword, setShowPassword] = useState(false)

  // 明文可见 15 秒后自动隐藏；每次切换为可见都重新计时，隐藏 / 卸载即清理定时器（issue #26）
  useEffect(() => {
    if (!showPassword) return
    const timer = window.setTimeout(() => setShowPassword(false), PASSWORD_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [showPassword])

  // 切换查看对象时重置密码可见状态（渲染期调整状态，避免 effect 级联渲染）
  const [prevEntryId, setPrevEntryId] = useState(entry.id)
  if (prevEntryId !== entry.id) {
    setPrevEntryId(entry.id)
    setShowPassword(false)
  }

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
          <p className="detail-meta">{t('detail.addedOn', { created: formatTime(entry.createdAt), updated: formatTime(entry.updatedAt) })}</p>
        </div>
        <button
          type="button"
          className={`icon-btn ${entry.favorite ? 'is-fav' : ''}`}
          title={entry.favorite ? t('entryRow.unfavorite') : t('entryRow.favorite')}
          onClick={() => onToggleFavorite(entry)}
        >
          <Icon name="star" size={17} filled={entry.favorite} />
        </button>
      </div>

      <div className="detail-fields">
        <div className="detail-field">
          <span className="detail-label">{t('detail.username')}</span>
          <span className="detail-value">{entry.username || <em className="detail-empty">{t('common.notSet')}</em>}</span>
          {entry.username && (
            <button
              type="button"
              className="icon-btn"
              title={t('detail.copyUser')}
              onClick={() => onCopy(entry.username, t('entryRow.userCopied'))}
            >
              <Icon name="copy" size={15} />
            </button>
          )}
        </div>

        <div className="detail-field">
          <span className="detail-label">{t('detail.password')}</span>
          <span className="detail-value mono">
            {entry.password ? (
              showPassword ? (
                entry.password
              ) : (
                '•'.repeat(Math.min(entry.password.length, 12))
              )
            ) : (
              <em className="detail-empty">{t('common.notSet')}</em>
            )}
          </span>
          {entry.password && (
            <>
              <button
                type="button"
                className="icon-btn"
                title={showPassword ? t('detail.hidePass') : t('detail.showPassHint')}
                onClick={() => setShowPassword((v) => !v)}
              >
                <Icon name={showPassword ? 'eye-off' : 'eye'} size={15} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={t('detail.copyPass')}
                onClick={() => onCopy(entry.password, t('entryRow.passCopied'))}
              >
                <Icon name="copy" size={15} />
              </button>
            </>
          )}
        </div>

        <div className="detail-field">
          <span className="detail-label">{t('detail.url')}</span>
          <span className="detail-value">{entry.url || <em className="detail-empty">{t('common.notSet')}</em>}</span>
          {entry.url && (
            <button
              type="button"
              className="icon-btn"
              title={t('detail.openInBrowser')}
              onClick={() => void window.safebox.openExternal(entry.url)}
            >
              <Icon name="external" size={15} />
            </button>
          )}
        </div>

        {entry.notes && (
          <div className="detail-field top">
            <span className="detail-label">{t('detail.notes')}</span>
            <span className="detail-value prewrap">{entry.notes}</span>
          </div>
        )}

        {entry.totpSecret && (
          <div className="detail-field">
            <span className="detail-label">{t('detail.totpLabel')}</span>
            <TOTPDisplay
              secret={entry.totpSecret}
              period={entry.totpPeriod ?? TOTP_PERIOD_SECONDS}
              digits={entry.totpDigits ?? TOTP_DIGITS}
              algorithm={entry.totpAlgorithm}
              onCopy={onCopy}
            />
          </div>
        )}

        {entry.passwordHistory && entry.passwordHistory.length > 0 && (
          <PasswordHistorySection items={entry.passwordHistory} onCopy={onCopy} />
        )}
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost btn-danger-ghost" onClick={() => onDelete(entry)}>
          <Icon name="trash" size={15} />
          {t('common.delete')}
        </button>
        <div className="modal-actions-right">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onEdit(entry)}>
            <Icon name="pencil" size={14} />
            {t('common.edit')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** 历史密码折叠区：默认收起，展开后逐条「显示/隐藏 + 复制」（单条独立超时隐藏） */
function PasswordHistorySection({
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
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!show) return
    const timer = window.setTimeout(() => setShow(false), PASSWORD_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [show])
  return (
    <div className="history-row">
      <span className="history-time">{formatTime(item.changedAt)}</span>
      <span className="detail-value mono">{show ? item.password : '•'.repeat(Math.min(item.password.length, 12))}</span>
      <button
        type="button"
        className="icon-btn"
        title={show ? t('common.hide') : t('detail.show15')}
        onClick={() => setShow((v) => !v)}
      >
        <Icon name={show ? 'eye-off' : 'eye'} size={14} />
      </button>
      <button type="button" className="icon-btn" title={t('common.copy')} onClick={() => onCopy(item.password, t('detail.historyCopied'))}>
        <Icon name="copy" size={14} />
      </button>
    </div>
  )
}

/** TOTP 验证码展示：码值 + 周期倒计时环 + 一键复制（每秒本地重算，零网络；参数取自条目，F18） */
function TOTPDisplay({
  secret,
  period,
  digits,
  algorithm,
  onCopy,
}: {
  secret: string
  period: number
  digits: number
  algorithm: 'SHA1' | 'SHA256' | 'SHA512' | undefined
  onCopy: (text: string, label: string) => void
}): React.JSX.Element {
  useLang()
  // 时间快照与码值同帧更新，避免窗口边界处码值与倒计时短暂错位
  const [state, setState] = useState<{ now: number; code: string | null }>({ now: 0, code: null })

  useEffect(() => {
    let cancelled = false
    function tick(): void {
      void totpCode(secret, Date.now(), { period, digits, algorithm })
        .then((code) => {
          if (!cancelled) setState({ now: Date.now(), code })
        })
        .catch(() => {
          if (!cancelled) setState({ now: Date.now(), code: null })
        })
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [secret, period, digits, algorithm])

  const remaining = state.now ? totpRemainingSeconds(state.now, period) : period
  const radius = 8
  const circumference = 2 * Math.PI * radius
  const urgent = remaining <= 5

  return (
    <div className="totp-display">
      <svg
        className={`totp-ring ${urgent ? 'is-urgent' : ''}`}
        width="22"
        height="22"
        viewBox="0 0 22 22"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r={radius} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
        <circle
          cx="11"
          cy="11"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - remaining / period)}
          transform="rotate(-90 11 11)"
        />
      </svg>
      <span className="detail-value mono totp-code">
        {state.code ? `${state.code.slice(0, digits / 2)} ${state.code.slice(digits / 2)}` : '••• •••'}
      </span>
      <span className="totp-remaining">{state.now ? `${remaining}s` : ''}</span>
      {state.code && (
        <button type="button" className="icon-btn" title={t('detail.copyTotp')} onClick={() => onCopy(state.code as string, t('detail.totpCopied'))}>
          <Icon name="copy" size={15} />
        </button>
      )}
    </div>
  )
}
