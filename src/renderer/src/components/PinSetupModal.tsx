import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'

interface PinSetupModalProps {
  /** 当前是否已设置 PIN（决定是否需要旧 PIN 与是否提供清除入口） */
  pinEnabled: boolean
  onClose: () => void
  /** 设置 / 修改成功回调（App 层负责调用 IPC 与刷新状态） */
  onSetup: (oldPin: string | undefined, newPin: string) => Promise<void>
  /** 清除 PIN 回调 */
  onClear: (oldPin: string) => Promise<void>
}

/** 设置 / 修改 / 清除锁定 PIN 的弹窗 */
export function PinSetupModal({ pinEnabled, onClose, onSetup, onClear }: PinSetupModalProps): React.JSX.Element {
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
    if (pinEnabled && !oldPin) return '请输入当前 PIN'
    const pin = newPin.trim()
    if (pin.length < 4 || pin.length > 32) return 'PIN 长度需为 4-32 个字符'
    if (pin !== confirmPin) return '两次输入的 PIN 不一致'
    if (pinEnabled && pin === oldPin.trim()) return '新 PIN 不能与当前 PIN 相同'
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
      setError(err instanceof Error ? err.message : '设置失败')
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
      setError(err instanceof Error ? err.message : '清除失败')
      setBusy(false)
    }
  }

  return (
    <Modal title={pinEnabled ? '修改锁定 PIN' : '设置锁定 PIN'} onClose={onClose}>
      <form onSubmit={(e) => void handleSetup(e)}>
        {pinEnabled && (
          <>
            <label className="field-label" htmlFor="pin-old">
              当前 PIN <span className="required">*</span>
            </label>
            <input
              ref={oldRef}
              id="pin-old"
              className="input"
              type="password"
              autoComplete="off"
              placeholder="输入当前 PIN"
              value={oldPin}
              onChange={(e) => setOldPin(e.target.value)}
            />
          </>
        )}

        <label className="field-label" htmlFor="pin-new">
          {pinEnabled ? '新 PIN' : 'PIN'} <span className="required">*</span>
        </label>
        <input
          id="pin-new"
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder="4-32 个字符"
          value={newPin}
          onChange={(e) => setNewPin(e.target.value)}
        />

        <label className="field-label" htmlFor="pin-confirm">
          确认新 PIN <span className="required">*</span>
        </label>
        <input
          id="pin-confirm"
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder="再次输入 PIN"
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value)}
        />

        <p className="gen-hint">
          启用后应用启动即锁定，系统空闲 5 分钟或按 Ctrl+L 也会锁定。PIN 以系统加密的摘要形式保存，请牢记，无法找回。
        </p>

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
              清除锁定
            </button>
          )}
          <div className="modal-actions-right">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {pinEnabled ? '修改 PIN' : '启用锁定'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
