import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import type { AppSettings } from '../../../../shared/types'

interface SettingsModalProps {
  onClose: () => void
}

/** 应用设置弹窗：目前仅「关闭主窗口时最小化到托盘」开关（issue #25） */
export function SettingsModal({ onClose }: SettingsModalProps): React.JSX.Element {
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
        if (!cancelled) setError('读取设置失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleToggleMinimizeToTray(value: boolean): Promise<void> {
    if (!settings || busy) return
    setBusy(true)
    setError('')
    try {
      const next = await window.safebox.updateSettings({ minimizeToTray: value })
      setSettings(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存设置失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="设置" onClose={onClose}>
      {!settings ? (
        <p className="gen-hint">{error || '加载中…'}</p>
      ) : (
        <>
          <label className="checkbox settings-row">
            <input
              type="checkbox"
              checked={settings.minimizeToTray}
              disabled={busy}
              onChange={(e) => void handleToggleMinimizeToTray(e.target.checked)}
            />
            <span>关闭主窗口时最小化到系统托盘</span>
          </label>
          <p className="gen-hint">
            开启后点击窗口 × 不会退出应用，SafeBox 常驻托盘，可通过托盘菜单或单击托盘图标随时唤回。全局锁定快捷键
            Ctrl+Alt+L 在任意界面均可生效。
          </p>
          {error && <p className="form-error">{error}</p>}
        </>
      )}

      <div className="modal-actions">
        <div className="modal-actions-right">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </Modal>
  )
}
