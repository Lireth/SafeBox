import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { t, useLang } from '../lib/i18n'
import type { UnlockResult } from '../../../../shared/types'

interface LockScreenProps {
  /** 校验 PIN 并解锁（由 App 层透传 window.safebox.unlockApp） */
  onSubmit: (pin: string) => Promise<UnlockResult>
}

/** 全屏锁定遮罩：锁定态下覆盖整个应用，输入 PIN 解锁 */
export function LockScreen({ onSubmit }: LockScreenProps): React.JSX.Element {
  useLang()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [failCount, setFailCount] = useState(0)
  /** 结构化结果携带的退避剩余秒数（>0 时禁用提交并本地倒计时） */
  const [cooldown, setCooldown] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  // 冷却倒计时：本地每秒递减，归零恢复提交（主进程侧仍有权威校验）
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  async function handleUnlock(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!pin || busy || cooldown > 0) return
    setBusy(true)
    setError('')
    // 失败信息以结构化错误码返回（O18）：按码渲染本地化文案，不解析消息文本
    let result: UnlockResult
    try {
      result = await onSubmit(pin)
    } catch {
      // IPC 通道级异常兜底（正常流程不会发生）
      setError(t('lockScreen.unlockFailed'))
      setBusy(false)
      return
    }
    // 成功：由父组件通过 lock:changed 广播切换界面
    if (result.ok) return
    setFailCount((n) => n + 1)
    setPin('')
    setBusy(false)
    inputRef.current?.focus()
    if (result.code === 'COOLDOWN') {
      setError(t('lockScreen.tooManyFails'))
      setCooldown(Math.max(1, Math.ceil((result.retryAfterMs ?? 30_000) / 1000)))
    } else if (result.code === 'NO_PIN') {
      // 防御分支：主进程仅在有 PIN 时才会锁定，正常流程不可达
      setError(t('lockScreen.noPin'))
    } else {
      setError(t('lockScreen.wrongPin'))
    }
  }

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={(e) => void handleUnlock(e)}>
        <div className="lock-icon">
          <Icon name="lock" size={26} strokeWidth={1.8} />
        </div>
        <h2 className="lock-title">{t('lockScreen.title')}</h2>
        <p className="lock-subtitle">{t('lockScreen.desc')}</p>
        <input
          ref={inputRef}
          className="input lock-input"
          type="password"
          inputMode="text"
          autoComplete="off"
          placeholder={t('lockScreen.pinPlaceholder')}
          value={pin}
          disabled={busy}
          maxLength={32}
          onChange={(e) => setPin(e.target.value)}
        />
        {error && <p className="form-error lock-error">{error}</p>}
        {failCount >= 2 && !error && <p className="lock-subtitle lock-fails">{t('lockScreen.failCount', { count: failCount })}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={!pin || busy || cooldown > 0}>
          {cooldown > 0 ? t('lockScreen.cooldown', { seconds: cooldown }) : busy ? t('lockScreen.verifying') : t('lockScreen.unlock')}
        </button>
      </form>
    </div>
  )
}
