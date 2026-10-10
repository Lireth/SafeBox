import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { resolveLang, setLang, t, useLang } from '../lib/i18n'
import { resolveIpcError } from '../lib/ipcError'
import type { AppSettings, UpdateCheckResult } from '../../../../shared/types'

interface SettingsModalProps {
  onClose: () => void
}

/** 应用设置弹窗：托盘开关 / 开机自启 / 界面语言 / 空闲自动锁定 / 诊断日志导出（issue #25 / #33 / #34 / O20） */
export function SettingsModal({ onClose }: SettingsModalProps): React.JSX.Element {
  useLang()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 诊断日志导出成功提示（显示落盘路径） */
  const [diagNotice, setDiagNotice] = useState('')
  /** 手动检查更新状态（F25）：idle 未检查 / checking 进行中 / 其余为检查结论 */
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null)
  /** 定时自动备份（F23）：口令输入 / 已设置状态 / 操作提示 */
  const [autoPwd, setAutoPwd] = useState('')
  const [autoPwdSet, setAutoPwdSet] = useState(false)
  const [autoNotice, setAutoNotice] = useState('')

  useEffect(() => {
    void window.safebox
      .getAutoBackupStatus()
      .then((s) => setAutoPwdSet(s.pwdSet))
      .catch(() => {})
  }, [])

  /** 选择自动备份目录：主进程对话框选定后直接落盘（渲染端不接触路径写入权） */
  async function selectAutoDir(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const result = await window.safebox.selectAutoBackupDir()
      if (!result.canceled && settings) setSettings({ ...settings, autoBackupDir: result.dir ?? '' })
    } finally {
      setBusy(false)
    }
  }

  /** 保存自动备份口令（safeStorage 加密存储，保存后不可回读） */
  async function saveAutoPwd(): Promise<void> {
    if (busy || !autoPwd) return
    setBusy(true)
    setAutoNotice('')
    try {
      await window.safebox.setAutoBackupPassword(autoPwd)
      setAutoPwdSet(true)
      setAutoPwd('')
      setAutoNotice(t('settings.autoBackupPwdSaved'))
    } catch (err) {
      setAutoNotice(resolveIpcError(err, t('settings.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void window.safebox
      .getSettings()
      .then((s) => {
        if (!cancelled) setSettings(s)
      })
      .catch(() => {
        if (!cancelled) setError(t('settings.readFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function persist(patch: Partial<AppSettings>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const next = await window.safebox.updateSettings(patch)
      setSettings(next)
      // 语言变更即时生效：auto 需结合系统 locale 解析
      if (patch.language !== undefined) {
        const locale = await window.safebox.getLocale()
        setLang(resolveLang(next.language, locale))
      }
    } catch (err) {
      setError(resolveIpcError(err, t('settings.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  /** 导出诊断日志（issue #35）：主进程弹保存对话框，落盘已脱敏缓冲 */
  async function exportDiagnostics(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    setDiagNotice('')
    try {
      const result = await window.safebox.exportDiagnostics()
      if (!result.canceled && result.path) setDiagNotice(t('settings.diagnosticsExported', { path: result.path }))
    } catch (err) {
      setError(resolveIpcError(err, t('settings.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  /** 手动检查更新（F25）：结论就地展示，发现新版本时后台继续下载（就绪后经全局横幅） */
  async function checkUpdate(): Promise<void> {
    if (busy || checking) return
    setChecking(true)
    setCheckResult(null)
    try {
      setCheckResult(await window.safebox.checkForUpdate())
    } catch {
      setCheckResult({ status: 'error' })
    } finally {
      setChecking(false)
    }
  }

  return (
    <Modal title={t('settings.title')} onClose={onClose}>
      {!settings ? (
        <p className="gen-hint">{error || t('common.loading')}</p>
      ) : (
        <>
          <label className="checkbox settings-row">
            <input
              type="checkbox"
              checked={settings.minimizeToTray}
              disabled={busy}
              onChange={(e) => void persist({ minimizeToTray: e.target.checked })}
            />
            <span>{t('settings.minimizeToTray')}</span>
          </label>
          <p className="gen-hint">{t('settings.minimizeHint')}</p>

          <label className="checkbox settings-row">
            <input
              type="checkbox"
              checked={settings.openAtLogin}
              disabled={busy}
              onChange={(e) => void persist({ openAtLogin: e.target.checked })}
            />
            <span>{t('settings.openAtLogin')}</span>
          </label>
          <p className="gen-hint">{t('settings.openAtLoginHint')}</p>
          {settings.minimizeToTray && !settings.openAtLogin && (
            <p className="gen-hint">{t('settings.trayAutoStartHint')}</p>
          )}

          <label className="field-label" htmlFor="settings-language">
            {t('settings.languageLabel')}
          </label>
          <select
            id="settings-language"
            className="input"
            value={settings.language}
            disabled={busy}
            onChange={(e) => void persist({ language: e.target.value as AppSettings['language'] })}
          >
            <option value="auto">{t('settings.langAuto')}</option>
            <option value="zh">{t('settings.langZh')}</option>
            <option value="en">{t('settings.langEn')}</option>
          </select>

          <label className="field-label" htmlFor="settings-autolock">
            {t('settings.autoLockLabel')}
          </label>
          <select
            id="settings-autolock"
            className="input"
            value={settings.autoLockMinutes}
            disabled={busy}
            onChange={(e) => void persist({ autoLockMinutes: Number(e.target.value) })}
          >
            {[1, 5, 15, 30].map((m) => (
              <option key={m} value={m}>
                {t('settings.autoLockMinutes', { n: m })}
              </option>
            ))}
            <option value={0}>{t('settings.autoLockNever')}</option>
          </select>
          <p className="gen-hint">{t('settings.autoLockHint')}</p>

          <label className="checkbox settings-row">
            <input
              type="checkbox"
              checked={settings.lockOnMinimize}
              disabled={busy}
              onChange={(e) => void persist({ lockOnMinimize: e.target.checked })}
            />
            <span>{t('settings.lockOnMinimize')}</span>
          </label>
          <p className="gen-hint">{t('settings.lockOnMinimizeHint')}</p>

          <p className="field-label">{t('settings.autoBackupSection')}</p>
          <label className="checkbox settings-row">
            <input
              type="checkbox"
              checked={settings.autoBackupEnabled}
              disabled={busy}
              onChange={(e) => void persist({ autoBackupEnabled: e.target.checked })}
            />
            <span>{t('settings.autoBackupEnable')}</span>
          </label>
          {settings.autoBackupEnabled && (
            <>
              <label className="field-label" htmlFor="settings-autobackup-days">
                {t('settings.autoBackupDaysLabel')}
              </label>
              <select
                id="settings-autobackup-days"
                className="input"
                value={settings.autoBackupDays}
                disabled={busy}
                onChange={(e) => void persist({ autoBackupDays: Number(e.target.value) })}
              >
                {[1, 3, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>
                    {t('settings.autoBackupDays', { n: d })}
                  </option>
                ))}
              </select>
              <div className="field-row">
                <span className="gen-hint" style={{ flex: 1, wordBreak: 'break-all' }}>
                  {settings.autoBackupDir || t('settings.autoBackupNoDir')}
                </span>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void selectAutoDir()}>
                  {t('settings.autoBackupChooseDir')}
                </button>
              </div>
              <div className="field-row">
                <input
                  id="settings-autobackup-pwd"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  placeholder={t('settings.autoBackupPwdPlaceholder')}
                  value={autoPwd}
                  disabled={busy}
                  onChange={(e) => setAutoPwd(e.target.value)}
                />
                <button type="button" className="btn btn-ghost" disabled={busy || !autoPwd} onClick={() => void saveAutoPwd()}>
                  {t('settings.autoBackupSavePwd')}
                </button>
              </div>
              <p className="gen-hint">
                {autoNotice || (autoPwdSet ? t('settings.autoBackupPwdSet') : t('settings.autoBackupPwdMissing'))}
              </p>
            </>
          )}
          <p className="gen-hint">{t('settings.autoBackupHint')}</p>

          <label className="checkbox settings-row">
            <input
              type="checkbox"
              checked={settings.pwnedCheckEnabled}
              disabled={busy}
              onChange={(e) => void persist({ pwnedCheckEnabled: e.target.checked })}
            />
            <span>{t('settings.pwnedCheck')}</span>
          </label>
          <p className="gen-hint">{t('settings.pwnedCheckHint')}</p>

          <p className="field-label">{t('settings.updateSection')}</p>
          <button
            id="settings-check-update"
            type="button"
            className="btn btn-ghost"
            disabled={busy || checking}
            onClick={() => void checkUpdate()}
          >
            {t('settings.checkUpdate')}
          </button>
          {checking && <p className="gen-hint">{t('settings.checking')}</p>}
          {!checking && checkResult?.status === 'no-update' && <p className="gen-hint">{t('settings.upToDate')}</p>}
          {!checking && checkResult?.status === 'available' && (
            <p className="gen-hint">{t('settings.updateFound', { version: checkResult.version ?? '' })}</p>
          )}
          {!checking && checkResult?.status === 'error' && (
            <p className="form-error">{t('settings.checkFailed', { message: checkResult.message ?? '' })}</p>
          )}

          <p className="field-label">
            {t('settings.diagnosticsLabel')}
          </p>
          <p className="gen-hint">{t('settings.diagnosticsHint')}</p>
          <button
            id="settings-export-diagnostics"
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void exportDiagnostics()}
          >
            {t('settings.exportDiagnostics')}
          </button>
          {diagNotice && <p className="gen-hint">{diagNotice}</p>}

          {error && <p className="form-error">{error}</p>}
        </>
      )}

      <div className="modal-actions">
        <div className="modal-actions-right">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('settings.done')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
