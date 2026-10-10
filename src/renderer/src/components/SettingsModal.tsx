import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { resolveLang, setLang, t, useLang } from '../lib/i18n'
import type { AppSettings } from '../../../../shared/types'

interface SettingsModalProps {
  onClose: () => void
}

/** 应用设置弹窗：「关闭主窗口时最小化到托盘」开关 + 界面语言选择（issue #25 / #33） */
export function SettingsModal({ onClose }: SettingsModalProps): React.JSX.Element {
  useLang()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
      setError(err instanceof Error ? err.message : t('settings.saveFailed'))
    } finally {
      setBusy(false)
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
