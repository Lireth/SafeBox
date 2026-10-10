import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { getCategory } from '../lib/categories'
import { auditEntries, countRiskyEntries, type AuditReport } from '../lib/audit'
import { passwordStrength } from '../lib/password'
import { t, useLang } from '../lib/i18n'
import type { AccountEntry } from '../../../../shared/types'

interface AuditModalProps {
  entries: AccountEntry[]
  onClose: () => void
  /** 点击风险条目：关闭面板并打开该条目的编辑表单 */
  onEdit: (entry: AccountEntry) => void
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN')
}

/** 密码安全体检面板：弱口令 / 重复密码 / 久未更新三维扫描（全本地） */
export function AuditModal({ entries, onClose, onEdit }: AuditModalProps): React.JSX.Element {
  useLang()
  const [report, setReport] = useState<AuditReport | null>(null)
  /** 扫描异常（如 WebCrypto 不可用）：展示错误态而非无限 loading */
  const [failed, setFailed] = useState(false)

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
    return () => {
      cancelled = true
    }
  }, [entries])

  const risky = report ? countRiskyEntries(report) : 0
  const hasIssues =
    report !== null && (report.weak.length > 0 || report.duplicateGroups.length > 0 || report.stale.length > 0)

  function renderEntryItem(entry: AccountEntry, detail: string): React.JSX.Element {
    const category = getCategory(entry.category)
    const initial = entry.title.charAt(0).toUpperCase() || '?'
    return (
      <button
        key={`${entry.id}-${detail}`}
        type="button"
        className="audit-item"
        onClick={() => onEdit(entry)}
        title={t('audit.itemEditHint')}
      >
        <span className="entry-avatar sm" style={{ background: `hsl(${category.hue} 62% 52%)` }}>
          {initial}
        </span>
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
                  {report.stale.map((entry) => renderEntryItem(entry, t('audit.staleDetail', { date: formatTime(entry.updatedAt) })))}
                </section>
              )}
            </>
          ) : (
            <div className="audit-empty">
              <Icon name="check" size={32} strokeWidth={1.5} />
              <h3>{t('audit.allClearTitle')}</h3>
              <p>{t('audit.allClearDesc')}</p>
            </div>
          )}

          <p className="backup-hint audit-footnote">{t('audit.footnote')}</p>
        </div>
      )}
    </Modal>
  )
}
