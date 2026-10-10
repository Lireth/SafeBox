import { useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import type { BackupExportResult, BackupImportResult, CsvExportResult, CsvImportResult } from '../../../../shared/types'

interface BackupModalProps {
  onClose: () => void
  /** 导出（App 层透传 IPC，系统保存对话框） */
  onExport: (password: string) => Promise<BackupExportResult>
  /** 导入（App 层透传 IPC，系统打开对话框 + 自动备份） */
  onImport: (password: string) => Promise<BackupImportResult>
  /** 从第三方密码管理器导入 CSV（App 层透传 IPC，系统打开对话框） */
  onImportCsv: () => Promise<CsvImportResult>
  /** 导出明文 CSV（App 层透传 IPC；已启用锁定时需携带 PIN，主进程二次身份确认） */
  onExportCsv: (pin: string | undefined) => Promise<CsvExportResult>
  /** 是否已启用锁定 PIN（决定明文导出前是否要求输入 PIN） */
  pinEnabled: boolean
}

const MIN_PWD = 8

/** 备份与恢复弹窗：口令加密导出 / 从加密文件导入合并 / 从第三方管理器 CSV 导入 / 明文 CSV 导出（强确认） */
export function BackupModal({ onClose, onExport, onImport, onImportCsv, onExportCsv, pinEnabled }: BackupModalProps): React.JSX.Element {
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
    if (exportPwd.length < MIN_PWD) return fail(`导出口令长度至少 ${MIN_PWD} 个字符`)
    if (exportPwd !== exportPwd2) return fail('两次输入的导出口令不一致')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await onExport(exportPwd)
      if (!result.canceled) {
        setNotice(`已导出 ${result.count} 条账号，加密文件已保存到所选位置`)
        setExportPwd('')
        setExportPwd2('')
      }
    } catch (err) {
      return fail(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleImport(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    if (!importPwd) return fail('请输入备份文件的口令')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await onImport(importPwd)
      if (!result.canceled) {
        setNotice(
          `导入完成：新增 ${result.imported} 条，跳过重复 ${result.skipped} 条（文件共 ${result.total} 条）。导入前的数据已自动备份。`,
        )
        setImportPwd('')
      }
    } catch (err) {
      return fail(err instanceof Error ? err.message : '导入失败')
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
        const parts = [`新增 ${result.imported} 条`, `跳过重复 ${result.skipped} 条`]
        if (result.invalid) parts.push(`忽略无名称行 ${result.invalid} 条`)
        setNotice(`CSV 导入完成：${parts.join('，')}（有效行共 ${result.total} 条）。`)
      }
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'CSV 导入失败')
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
        setNotice(`已导出 ${result.count} 条账号为明文 CSV。文件未加密，请妥善保管并尽快删除。`)
        setCsvConfirm(false)
        setCsvPin('')
      }
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'CSV 导出失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="备份与恢复" onClose={onClose}>
      <form onSubmit={(e) => void handleExport(e)}>
        <div className="backup-section">
          <span className="field-label">
            <Icon name="download" size={13} /> 导出加密备份
          </span>
          <p className="backup-hint">
            使用独立口令加密（scrypt 派生 +
            AES-256-GCM），不依赖本机系统加密，可在换机或重装系统后恢复。口令遗失将无法恢复备份。
          </p>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="导出口令（至少 8 个字符）"
            value={exportPwd}
            disabled={busy}
            onChange={(e) => setExportPwd(e.target.value)}
          />
          <input
            className="input backup-input"
            type="password"
            autoComplete="new-password"
            placeholder="确认导出口令"
            value={exportPwd2}
            disabled={busy}
            onChange={(e) => setExportPwd2(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !exportPwd || !exportPwd2}>
            选择位置并导出
          </button>
        </div>
      </form>

      <div className="backup-divider" />

      <form onSubmit={(e) => void handleImport(e)}>
        <div className="backup-section">
          <span className="field-label">
            <Icon name="upload" size={13} /> 从备份文件导入
          </span>
          <p className="backup-hint">
            仅新增备份文件中不存在的账号，已有条目不会被覆盖。导入前当前数据会自动创建一份完整备份。
          </p>
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder="备份文件的口令"
            value={importPwd}
            disabled={busy}
            onChange={(e) => setImportPwd(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !importPwd}>
            选择文件并导入
          </button>
        </div>
      </form>

      <div className="backup-divider" />

      <div className="backup-section">
        <span className="field-label">
          <Icon name="upload" size={13} /> 从其他密码管理器导入（CSV）
        </span>
        <p className="backup-hint">
          支持 Chrome、Bitwarden、1Password 等导出的 CSV 文件，仅新增不存在的账号（按名称+用户名去重），导入前当前数据会自动创建一份完整备份。
        </p>
        <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={() => void handleImportCsv()}>
          选择 CSV 文件并导入
        </button>
      </div>

      <div className="backup-divider" />

      <div className="backup-section">
        <span className="field-label">
          <Icon name="download" size={13} /> 导出明文 CSV（迁移到其他管理器）
        </span>
        {!csvConfirm ? (
          <>
            <p className="backup-hint">
              以未加密的标准 CSV（name,url,username,password,notes,totp）导出全部账号，便于迁移到浏览器或其他密码管理器。
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-danger-ghost btn-block"
              disabled={busy}
              onClick={() => {
                setCsvConfirm(true)
                setError('')
              }}
            >
              导出明文 CSV…
            </button>
          </>
        ) : (
          <div className="csv-confirm">
            <p className="csv-confirm-warning">
              <Icon name="alert-triangle" size={14} className="csv-confirm-icon" />
              <span>
                <strong>风险确认：</strong>
                明文 CSV 中的密码<strong>未加密</strong>，任何拿到该文件的人都能直接读取全部账号。仅在迁移数据时使用，导出后请妥善保管，并尽快从下载目录等位置删除。
              </span>
            </p>
            {pinEnabled && (
              <>
                <label className="field-label" htmlFor="csv-export-pin">
                  输入锁定 PIN 以确认身份 <span className="required">*</span>
                </label>
                <input
                  id="csv-export-pin"
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder="锁定 PIN"
                  value={csvPin}
                  disabled={busy}
                  onChange={(e) => setCsvPin(e.target.value)}
                />
              </>
            )}
            <div className="csv-confirm-actions">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setCsvConfirm(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy || (pinEnabled && !csvPin)}
                onClick={() => void handleExportCsv()}
              >
                我已了解风险，继续导出
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
