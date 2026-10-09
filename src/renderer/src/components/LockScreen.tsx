import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

interface LockScreenProps {
  /** 校验 PIN 并解锁（由 App 层透传 window.safebox.unlockApp） */
  onSubmit: (pin: string) => Promise<void>
}

/** 全屏锁定遮罩：锁定态下覆盖整个应用，输入 PIN 解锁 */
export function LockScreen({ onSubmit }: LockScreenProps): React.JSX.Element {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [failCount, setFailCount] = useState(0)
  /** 主进程退避提示中解析出的剩余冷却秒数（>0 时禁用提交并本地倒计时） */
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
    try {
      await onSubmit(pin)
      // 成功后由父组件通过 lock:changed 广播切换界面
    } catch (err) {
      const message = err instanceof Error ? err.message : '解锁失败'
      setError(message)
      setFailCount((n) => n + 1)
      setPin('')
      // 从「请 N 秒后重试」/「已锁定 N 秒」文案解析退避时长，进入本地倒计时
      const match = message.match(/(\d+)\s*秒/)
      if (message.includes('失败次数过多') && match) {
        setCooldown(parseInt(match[1], 10) || 30)
      }
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={(e) => void handleUnlock(e)}>
        <div className="lock-icon">
          <Icon name="lock" size={26} strokeWidth={1.8} />
        </div>
        <h2 className="lock-title">秘匣已锁定</h2>
        <p className="lock-subtitle">输入锁定 PIN 以继续访问您的账号</p>
        <input
          ref={inputRef}
          className="input lock-input"
          type="password"
          inputMode="text"
          autoComplete="off"
          placeholder="锁定 PIN"
          value={pin}
          disabled={busy}
          onChange={(e) => setPin(e.target.value)}
        />
        {error && <p className="form-error lock-error">{error}</p>}
        {failCount >= 2 && !error && <p className="lock-subtitle lock-fails">已连续失败 {failCount} 次</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={!pin || busy || cooldown > 0}>
          {cooldown > 0 ? `请 ${cooldown} 秒后重试` : busy ? '验证中…' : '解锁'}
        </button>
      </form>
    </div>
  )
}
