import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { t, useLang } from '../lib/i18n'

interface PinSetupModalProps {
  /** 当前是否已设置 PIN（决定是否需要旧 PIN 与是否提供清除入口） */
  pinEnabled: boolean
  onClose: () => void
  /** 设置 / 修改成功回调（App 层负责调用 IPC 与刷新状态） */
  onSetup: (oldPin: string | undefined, newPin: string) => Promise<void>
  /** 清除 PIN 回调 */
  onClear: (oldPin: string) => Promise<void>
}

const PIN_MIN = 4
const PIN_MAX = 32

/** 设置 / 修改 / 清除锁定 PIN 的弹窗 */
export function PinSetupModal({ pinEnabled, onClose, onSetup, onClear }: PinSetupModalProps): React.JSX.Element {
  useLang()
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const oldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pinEnabled) oldRef.current?.focus()
  }, [pinEnabled])

  function validate(): string | null {
    if (pinEnabled && !oldPin) return t('pinSetup.needOldPin')
    const pin = newPin.trim()
    if (pin.length < PIN_MIN || pin.length > PIN_MAX) return t('pinSetup.pinLengthErr', { min: PIN_MIN, max: PIN_MAX })
    if (pin !== confirmPin) return t('pinSetup.pinMismatch')
    if (pinEnabled && pin === oldPin.trim()) return t('pinSetup.pinSame')
    return null
  }

  async function handleSetup(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSetup(pinEnabled ? oldPin.trim() : undefined, newPin.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pinSetup.setupFailed'))
      setBusy(false)
    }
  }

  async function handleClear(): Promise<void> {
    if (busy || !oldPin) return
    setBusy(true)
    setError('')
    try {
      await onClear(oldPin.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pinSetup.clearFailed'))
      setBusy(false)
    }
  }

  return (
    <Modal title={pinEnabled ? t('pinSetup.titleEdit') : t('pinSetup.titleSet')} onClose={onClose}>
      <form onSubmit={(e) => void handleSetup(e)}>
        {pinEnabled && (
          <>
            <label className="field-label" htmlFor="pin-old">
              {t('pinSetup.currentPinLabel')} <span className="required">*</span>
            </label>
            <input
              ref={oldRef}
              id="pin-old"
              className="input"
              type="password"
              autoComplete="off"
              placeholder={t('pinSetup.currentPinPlaceholder')}
              value={oldPin}
              onChange={(e) => setOldPin(e.target.value)}
            />
          </>
        )}

        <label className="field-label" htmlFor="pin-new">
          {pinEnabled ? t('pinSetup.newPinLabel') : t('pinSetup.pinLabel')} <span className="required">*</span>
        </label>
        <input
          id="pin-new"
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder={t('pinSetup.newPinPlaceholder')}
          value={newPin}
          onChange={(e) => setNewPin(e.target.value)}
        />

        <label className="field-label" htmlFor="pin-confirm">
          {t('pinSetup.confirmLabel')} <span className="required">*</span>
        </label>
        <input
          id="pin-confirm"
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder={t('pinSetup.confirmPlaceholder')}
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value)}
        />

        <p className="gen-hint">{t('pinSetup.hint')}</p>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          {pinEnabled && (
            <button
              type="button"
              className="btn btn-ghost btn-danger-ghost"
              disabled={busy || !oldPin}
              onClick={() => void handleClear()}
            >
              <Icon name="trash" size={14} />
              {t('pinSetup.clearLock')}
            </button>
          )}
          <div className="modal-actions-right">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {pinEnabled ? t('pinSetup.submitEdit') : t('pinSetup.submitSet')}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
