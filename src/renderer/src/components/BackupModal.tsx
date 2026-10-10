import { useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { t, useLang } from '../lib/i18n'
import { resolveIpcError } from '../lib/ipcError'
import type { BackupExportResult, BackupImportResult, CsvExportResult, CsvImportResult } from '../../../../shared/types'

interface BackupModalProps {
  onClose: () => void
  /** 导出（App 层透传 IPC，系统保存对话框） */
  onExport: (password: string) => Promise<BackupExportResult>
  /** 导入（App 层透传 IPC，系统打开对话框 + 自动备份） */
  onImport: (password: string) => Promise<BackupImportResult>
  /** 从第三方密码管理器导入 CSV（App 层透传 IPC，系统打开对话框） */
  onImportCsv: () => Promise<CsvImportResult>
  /** 从 Bitwarden 未加密 JSON 导入（F22；App 层透传 IPC，系统打开对话框） */
  onImportJson: () => Promise<CsvImportResult>
  /** 导出明文 CSV（App 层透传 IPC；已启用锁定时需携带 PIN，主进程二次身份确认） */
  onExportCsv: (pin: string | undefined) => Promise<CsvExportResult>
  /** 是否已启用锁定 PIN（决定明文导出前是否要求输入 PIN） */
  pinEnabled: boolean
}

const MIN_PWD = 8

/** 备份与恢复弹窗：口令加密导出 / 从加密文件导入合并 / 从第三方管理器 CSV 导入 / 明文 CSV 导出（强确认） */
export function BackupModal({ onClose, onExport, onImport, onImportCsv, onImportJson, onExportCsv, pinEnabled }: BackupModalProps): React.JSX.Element {
  useLang()
  const [exportPwd, setExportPwd] = useState('')
  const [exportPwd2, setExportPwd2] = useState('')
  const [importPwd, setImportPwd] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  /** 明文 CSV 导出：是否处于强确认态 */
  const [csvConfirm, setCsvConfirm] = useState(false)
  /** 强确认态输入的锁定 PIN（pinEnabled 时必填） */
  const [csvPin, setCsvPin] = useState('')

  function fail(message: string): void {
    setError(message)
    setNotice('')
    setBusy(false)
  }

  async function handleExport(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    if (exportPwd.length < MIN_PWD) return fail(t('backup.exportPwdTooShort', { min: MIN_PWD }))
    if (exportPwd !== exportPwd2) return fail(t('backup.exportPwdMismatch'))
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await onExport(exportPwd)
      if (!result.canceled) {
        setNotice(t('backup.exportDone', { count: result.count }))
        setExportPwd('')
        setExportPwd2('')
      }
    } catch (err) {
      return fail(resolveIpcError(err, t('backup.exportFailed')))
    } finally {
      setBusy(false)
    }
  }

  async function handleImport(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    if (!importPwd) return fail(t('backup.importPwdEmpty'))
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await onImport(importPwd)
      if (!result.canceled) {
        setNotice(t('backup.importDone', { imported: result.imported, skipped: result.skipped, total: result.total }))
        setImportPwd('')
      }
    } catch (err) {
      return fail(resolveIpcError(err, t('backup.importFailed')))
    } finally {
      setBusy(false)
    }
  }

  async function handleImportCsv(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await onImportCsv()
      if (!result.canceled) {
        const parts = [t('backup.csvImportAdded', { n: result.imported }), t('backup.csvImportSkipped', { n: result.skipped })]
        if (result.invalid) parts.push(t('backup.csvImportInvalid', { n: result.invalid }))
        setNotice(t('backup.csvImportDone', { parts: parts.join('，'), total: result.total }))
      }
    } catch (err) {
      return fail(resolveIpcError(err, t('backup.csvImportFailed')))
    } finally {
      setBusy(false)
    }
  }

  /** Bitwarden 未加密 JSON 导入（F22）：提示结构与 CSV 一致，仅文案前缀不同 */
  async function handleImportJson(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await onImportJson()
      if (!result.canceled) {
        const parts = [t('backup.csvImportAdded', { n: result.imported }), t('backup.csvImportSkipped', { n: result.skipped })]
        if (result.invalid) parts.push(t('backup.csvImportInvalid', { n: result.invalid }))
        setNotice(t('backup.jsonImportDone', { parts: parts.join('，'), total: result.total }))
      }
    } catch (err) {
      return fail(resolveIpcError(err, t('backup.jsonImportFailed')))
    } finally {
      setBusy(false)
    }
  }

  /** 明文 CSV 导出（强确认后）：取消保存对话框不产生文件 */
  async function handleExportCsv(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await onExportCsv(pinEnabled ? csvPin : undefined)
      if (!result.canceled) {
        setNotice(t('backup.csvExportDone', { count: result.count }))
        setCsvConfirm(false)
        setCsvPin('')
      }
    } catch (err) {
      return fail(resolveIpcError(err, t('backup.csvExportFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('backup.title')} onClose={onClose}>
      <form onSubmit={(e) => void handleExport(e)}>
        <div className="backup-section">
          <span className="field-label">
            <Icon name="download" size={13} /> {t('backup.exportLabel')}
          </span>
          <p className="backup-hint">{t('backup.exportHint')}</p>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder={t('backup.exportPwdPlaceholder')}
            value={exportPwd}
            disabled={busy}
            onChange={(e) => setExportPwd(e.target.value)}
          />
          <input
            className="input backup-input"
            type="password"
            autoComplete="new-password"
            placeholder={t('backup.exportPwd2Placeholder')}
            value={exportPwd2}
            disabled={busy}
            onChange={(e) => setExportPwd2(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !exportPwd || !exportPwd2}>
            {t('backup.exportBtn')}
          </button>
        </div>
      </form>

      <div className="backup-divider" />

      <form onSubmit={(e) => void handleImport(e)}>
        <div className="backup-section">
          <span className="field-label">
            <Icon name="upload" size={13} /> {t('backup.importLabel')}
          </span>
          <p className="backup-hint">{t('backup.importHint')}</p>
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder={t('backup.importPwdPlaceholder')}
            value={importPwd}
            disabled={busy}
            onChange={(e) => setImportPwd(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !importPwd}>
            {t('backup.importBtn')}
          </button>
        </div>
      </form>

      <div className="backup-divider" />

      <div className="backup-section">
        <span className="field-label">
          <Icon name="upload" size={13} /> {t('backup.csvImportLabel')}
        </span>
        <p className="backup-hint">{t('backup.csvImportHint')}</p>
        <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={() => void handleImportCsv()}>
          {t('backup.csvImportBtn')}
        </button>
      </div>

      <div className="backup-divider" />

      <div className="backup-section">
        <span className="field-label">
          <Icon name="upload" size={13} /> {t('backup.jsonImportLabel')}
        </span>
        <p className="backup-hint">{t('backup.jsonImportHint')}</p>
        <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={() => void handleImportJson()}>
          {t('backup.jsonImportBtn')}
        </button>
      </div>

      <div className="backup-divider" />

      <div className="backup-section">
        <span className="field-label">
          <Icon name="download" size={13} /> {t('backup.csvExportLabel')}
        </span>
        {!csvConfirm ? (
          <>
            <p className="backup-hint">{t('backup.csvExportHint')}</p>
            <button
              type="button"
              className="btn btn-ghost btn-danger-ghost btn-block"
              disabled={busy}
              onClick={() => {
                setCsvConfirm(true)
                setError('')
              }}
            >
              {t('backup.csvExportBtn')}
            </button>
          </>
        ) : (
          <div className="csv-confirm">
            <p className="csv-confirm-warning">
              <Icon name="alert-triangle" size={14} className="csv-confirm-icon" />
              <span>
                <strong>{t('backup.csvConfirmStrong')}</strong>
                {t('backup.csvConfirmBody')}
              </span>
            </p>
            {pinEnabled && (
              <>
                <label className="field-label" htmlFor="csv-export-pin">
                  {t('backup.csvPinLabel')} <span className="required">*</span>
                </label>
                <input
                  id="csv-export-pin"
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder={t('backup.csvPinPlaceholder')}
                  value={csvPin}
                  disabled={busy}
                  onChange={(e) => setCsvPin(e.target.value)}
                />
              </>
            )}
            <div className="csv-confirm-actions">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setCsvConfirm(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy || (pinEnabled && !csvPin)}
                onClick={() => void handleExportCsv()}
              >
                {t('backup.csvConfirmBtn')}
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="backup-notice">{notice}</p>}
    </Modal>
  )
}
