import { useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import type { BackupExportResult, BackupImportResult } from '../../../../shared/types'

interface BackupModalProps {
  onClose: () => void
  /** 导出（App 层透传 IPC，系统保存对话框） */
  onExport: (password: string) => Promise<BackupExportResult>
  /** 导入（App 层透传 IPC，系统打开对话框 + 自动备份） */
  onImport: (password: string) => Promise<BackupImportResult>
}

const MIN_PWD = 8

/** 备份与恢复弹窗：口令加密导出 / 从加密文件导入合并 */
export function BackupModal({ onClose, onExport, onImport }: BackupModalProps): React.JSX.Element {
  const [exportPwd, setExportPwd] = useState('')
  const [exportPwd2, setExportPwd2] = useState('')
  const [importPwd, setImportPwd] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

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

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="backup-notice">{notice}</p>}
    </Modal>
  )
}
