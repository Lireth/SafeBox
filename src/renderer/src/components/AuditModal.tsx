import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { getCategory } from '../lib/categories'
import { auditEntries, countRiskyEntries, type AuditReport } from '../lib/audit'
import { passwordStrength } from '../lib/password'
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
  const [report, setReport] = useState<AuditReport | null>(null)

  useEffect(() => {
    let cancelled = false
    void auditEntries(entries).then((result) => {
      if (!cancelled) setReport(result)
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
        title="点击修改该账号"
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
    <Modal wide title="安全体检" onClose={onClose}>
      {report === null ? (
        <div className="audit-loading">
          <div className="spinner" />
        </div>
      ) : entries.length === 0 ? (
        <div className="audit-empty">
          <Icon name="shield" size={32} strokeWidth={1.5} />
          <h3>还没有可检查的账号</h3>
          <p>添加账号后即可进行本地安全体检</p>
        </div>
      ) : (
        <div className="audit-body">
          <div className={`audit-summary ${hasIssues ? 'audit-summary-warn' : 'audit-summary-ok'}`}>
            <Icon name={hasIssues ? 'alert-triangle' : 'check'} size={18} />
            {hasIssues
              ? `已扫描 ${report.scanned} 个账号，发现 ${risky} 个账号存在安全风险`
              : `已扫描 ${report.scanned} 个账号，全部通过安全检查`}
          </div>

          {hasIssues ? (
            <>
              {report.weak.length > 0 && (
                <section className="audit-group">
                  <h4 className="audit-group-title">
                    <Icon name="alert-triangle" size={14} className="audit-weak" />
                    弱密码
                    <span className="audit-count">{report.weak.length}</span>
                  </h4>
                  {report.weak.map((entry) =>
                    renderEntryItem(entry, `密码强度：${passwordStrength(entry.password).label}`),
                  )}
                </section>
              )}

              {report.duplicateGroups.length > 0 && (
                <section className="audit-group">
                  <h4 className="audit-group-title">
                    <Icon name="copy" size={14} className="audit-dup" />
                    重复密码
                    <span className="audit-count">{report.duplicateGroups.length} 组</span>
                  </h4>
                  {report.duplicateGroups.map((group, index) => (
                    <div key={index} className="audit-dup-group">
                      {group.map((entry) => renderEntryItem(entry, '与其他账号使用相同密码'))}
                    </div>
                  ))}
                </section>
              )}

              {report.stale.length > 0 && (
                <section className="audit-group">
                  <h4 className="audit-group-title">
                    <Icon name="clock" size={14} className="audit-stale" />
                    久未更新（超过 6 个月）
                    <span className="audit-count">{report.stale.length}</span>
                  </h4>
                  {report.stale.map((entry) => renderEntryItem(entry, `最后更新：${formatTime(entry.updatedAt)}`))}
                </section>
              )}
            </>
          ) : (
            <div className="audit-empty">
              <Icon name="check" size={32} strokeWidth={1.5} />
              <h3>太棒了，未发现安全风险</h3>
              <p>建议保持定期更换密码的习惯</p>
            </div>
          )}

          <p className="backup-hint audit-footnote">体检全程在本机完成，不会发起任何网络请求。</p>
        </div>
      )}
    </Modal>
  )
}
