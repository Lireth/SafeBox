import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { EntryAvatar } from './EntryAvatar'
import { auditEntries, type AuditReport } from '../lib/audit'
import { findPwnedEntries } from '../lib/hibp'
import { formatDate } from '../lib/format'
import { passwordStrength } from '../lib/password'
import { t, useLang } from '../lib/i18n'
import type { AccountEntry } from '../../../../shared/types'

interface AuditModalProps {
  entries: AccountEntry[]
  onClose: () => void
  /** 点击风险条目：关闭面板并打开该条目的编辑表单 */
  onEdit: (entry: AccountEntry) => void
}

/** 泄露检查状态（F21）：null=进行中/未启用（配合 pwnedEnabled 区分），failed=网络失败 */
interface PwnedState {
  list: AccountEntry[]
  failed: boolean
}

/** 密码安全体检面板：弱口令 / 重复密码 / 久未更新（全本地）+ 泄露检查（F21，opt-in 网络第四维） */
export function AuditModal({ entries, onClose, onEdit }: AuditModalProps): React.JSX.Element {
  useLang()
  const [report, setReport] = useState<AuditReport | null>(null)
  /** 扫描异常（如 WebCrypto 不可用）：展示错误态而非无限 loading */
  const [failed, setFailed] = useState(false)
  /** 泄露检查（opt-in）：仅当设置开启时执行网络查询 */
  const [pwnedEnabled, setPwnedEnabled] = useState(false)
  const [pwned, setPwned] = useState<PwnedState | null>(null)

  useEffect(() => {
    let cancelled = false
    void auditEntries(entries)
      .then((result) => {
        if (!cancelled) {
          setFailed(false)
          setReport(result)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    // 泄露检查：读取设置判定 opt-in；开启才发起 k-匿名查询（设置读取失败视为未开启）
    void (async () => {
      try {
        const settings = await window.safebox.getSettings()
        if (cancelled || !settings.pwnedCheckEnabled) return
        setPwnedEnabled(true)
        setPwned(null)
        const result = await findPwnedEntries(entries)
        if (!cancelled) setPwned({ list: result.list, failed: result.failed })
      } catch {
        // 保持未启用状态
      }
    })()
    return () => {
      cancelled = true
    }
  }, [entries])

  const pwnedList = pwned?.list ?? []
  // 风险计数：本地三维 + 泄露命中，按条目去重
  const riskyIds = new Set<string>()
  if (report) {
    for (const e of report.weak) riskyIds.add(e.id)
    for (const group of report.duplicateGroups) for (const e of group) riskyIds.add(e.id)
    for (const e of report.stale) riskyIds.add(e.id)
  }
  for (const e of pwnedList) riskyIds.add(e.id)
  const risky = riskyIds.size
  const hasIssues = report !== null && (risky > 0)

  function renderEntryItem(entry: AccountEntry, detail: string): React.JSX.Element {
    return (
      <button
        key={`${entry.id}-${detail}`}
        type="button"
        className="audit-item"
        onClick={() => onEdit(entry)}
        title={t('audit.itemEditHint')}
      >
        <EntryAvatar title={entry.title} category={entry.category} size="sm" />
        <span className="audit-item-main">
          <span className="audit-item-title">{entry.title}</span>
          <span className="audit-item-detail">{detail}</span>
        </span>
        <Icon name="pencil" size={13} className="audit-item-action" />
      </button>
    )
  }

  return (
    <Modal wide title={t('audit.title')} onClose={onClose}>
      {failed ? (
        <div className="audit-empty">
          <Icon name="alert-triangle" size={32} strokeWidth={1.5} />
          <h3>{t('audit.errorTitle')}</h3>
          <p>{t('audit.errorDesc')}</p>
        </div>
      ) : report === null ? (
        <div className="audit-loading">
          <div className="spinner" />
        </div>
      ) : entries.length === 0 ? (
        <div className="audit-empty">
          <Icon name="shield" size={32} strokeWidth={1.5} />
          <h3>{t('audit.emptyTitle')}</h3>
          <p>{t('audit.emptyDesc')}</p>
        </div>
      ) : (
        <div className="audit-body">
          <div className={`audit-summary ${hasIssues ? 'audit-summary-warn' : 'audit-summary-ok'}`}>
            <Icon name={hasIssues ? 'alert-triangle' : 'check'} size={18} />
            {hasIssues
              ? t('audit.summaryWarn', { scanned: report.scanned, risky })
              : t('audit.summaryOk', { scanned: report.scanned })}
          </div>

          {hasIssues ? (
            <>
              {report.weak.length > 0 && (
                <section className="audit-group">
                  <h4 className="audit-group-title">
                    <Icon name="alert-triangle" size={14} className="audit-weak" />
                    {t('audit.weakTitle')}
                    <span className="audit-count">{report.weak.length}</span>
                  </h4>
                  {report.weak.map((entry) =>
                    renderEntryItem(entry, t('audit.weakDetail', { label: passwordStrength(entry.password).label })),
                  )}
                </section>
              )}

              {report.duplicateGroups.length > 0 && (
                <section className="audit-group">
                  <h4 className="audit-group-title">
                    <Icon name="copy" size={14} className="audit-dup" />
                    {t('audit.dupTitle')}
                    <span className="audit-count">{t('audit.dupGroups', { n: report.duplicateGroups.length })}</span>
                  </h4>
                  {report.duplicateGroups.map((group, index) => (
                    <div key={index} className="audit-dup-group">
                      {group.map((entry) => renderEntryItem(entry, t('audit.dupDetail')))}
                    </div>
                  ))}
                </section>
              )}

              {report.stale.length > 0 && (
                <section className="audit-group">
                  <h4 className="audit-group-title">
                    <Icon name="clock" size={14} className="audit-stale" />
                    {t('audit.staleTitle')}
                    <span className="audit-count">{report.stale.length}</span>
                  </h4>
                  {report.stale.map((entry) => renderEntryItem(entry, t('audit.staleDetail', { date: formatDate(entry.updatedAt) })))}
                </section>
              )}

              {/* 泄露检查（F21，opt-in）：null=查询进行中 */}
              {pwnedEnabled &&
                (pwned === null ? (
                  <section className="audit-group">
                    <h4 className="audit-group-title">
                      <Icon name="download" size={14} className="audit-stale" />
                      {t('audit.pwnedScanning')}
                    </h4>
                  </section>
                ) : (
                  <>
                    {pwnedList.length > 0 && (
                      <section className="audit-group">
                        <h4 className="audit-group-title">
                          <Icon name="alert-triangle" size={14} className="audit-weak" />
                          {t('audit.pwnedTitle')}
                          <span className="audit-count">{pwnedList.length}</span>
                        </h4>
                        {pwnedList.map((entry) => renderEntryItem(entry, t('audit.pwnedDetail')))}
                      </section>
                    )}
                    {pwned.failed && <p className="form-error">{t('audit.pwnedFailed')}</p>}
                  </>
                ))}
            </>
          ) : (
            <div className="audit-empty">
              <Icon name="check" size={32} strokeWidth={1.5} />
              <h3>{t('audit.allClearTitle')}</h3>
              <p>{t('audit.allClearDesc')}</p>
            </div>
          )}

          <p className="backup-hint audit-footnote">{pwnedEnabled ? t('audit.footnoteNet') : t('audit.footnote')}</p>
        </div>
      )}
    </Modal>
  )
}
