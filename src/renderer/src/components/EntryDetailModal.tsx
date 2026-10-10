import { useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { EntryAvatar } from './EntryAvatar'
import { TotpDisplay } from './TotpDisplay'
import { PasswordHistorySection } from './PasswordHistorySection'
import { getCategory } from '../lib/categories'
import { TOTP_DIGITS, TOTP_PERIOD_SECONDS } from '../lib/totp'
import { formatDateTime, maskPassword } from '../lib/format'
import { useAutoHide } from '../lib/useAutoHide'
import { t, useLang } from '../lib/i18n'
import type { AccountEntry } from '../../../../shared/types'

interface EntryDetailModalProps {
  entry: AccountEntry
  onClose: () => void
  onEdit: (entry: AccountEntry) => void
  onDelete: (entry: AccountEntry) => void
  onToggleFavorite: (entry: AccountEntry) => void
  onCopy: (text: string, label: string) => void
  /** 错误反馈（如打开链接失败，O22）：App 层透传 toast */
  onError: (message: string) => void
}

export function EntryDetailModal({
  entry,
  onClose,
  onEdit,
  onDelete,
  onToggleFavorite,
  onCopy,
  onError,
}: EntryDetailModalProps): React.JSX.Element {
  useLang()
  const passwordVisible = useAutoHide()

  // 切换查看对象时重置密码可见状态（渲染期调整状态，避免 effect 级联渲染）
  const [prevEntryId, setPrevEntryId] = useState(entry.id)
  if (prevEntryId !== entry.id) {
    setPrevEntryId(entry.id)
    passwordVisible.hide()
  }

  const category = getCategory(entry.category)

  return (
    <Modal wide onClose={onClose} ariaLabel={entry.title}>
      <div className="detail-header">
        <EntryAvatar title={entry.title} category={entry.category} size="lg" />
        <div className="detail-heading">
          <div className="detail-title-line">
            <h3 className="detail-title">{entry.title}</h3>
            <span className="entry-chip" style={{ color: `hsl(${category.hue} 45% 45%)` }}>
              {category.label}
            </span>
          </div>
          <p className="detail-meta">
            {t('detail.addedOn', { created: formatDateTime(entry.createdAt), updated: formatDateTime(entry.updatedAt) })}
          </p>
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
              passwordVisible.visible ? (
                entry.password
              ) : (
                maskPassword(entry.password)
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
                title={passwordVisible.visible ? t('detail.hidePass') : t('detail.showPassHint')}
                onClick={passwordVisible.toggle}
              >
                <Icon name={passwordVisible.visible ? 'eye-off' : 'eye'} size={15} />
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
              onClick={() =>
                void window.safebox.openExternal(entry.url).catch((err: unknown) => {
                  // 打开失败必须有反馈（O22）：优先展示主进程错误（如非 http/https），否则本地化兜底
                  onError(err instanceof Error ? err.message : t('detail.openLinkFailed'))
                })
              }
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
            <TotpDisplay
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
