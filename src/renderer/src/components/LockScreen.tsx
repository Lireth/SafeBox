import { useState } from 'react'
import { Icon } from './Icon'
import { AuthLayout } from './AuthLayout'

interface LockScreenProps {
  onUnlock: (masterPassword: string) => Promise<void>
}

/** 解锁屏：输入主密码解锁金库 */
export function LockScreen({ onUnlock }: LockScreenProps): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError('')
    try {
      await onUnlock(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : '解锁失败')
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="秘匣已锁定" subtitle="输入主密码解锁您的账号数据">
      <form onSubmit={(e) => void handleSubmit(e)}>
        <input
          className="input"
          type="password"
          placeholder="主密码"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={!password || busy}>
          <Icon name="unlock" size={16} />
          解锁
        </button>
        <p className="form-hint">为保护数据安全，金库在无操作 10 分钟后会自动锁定</p>
      </form>
    </AuthLayout>
  )
}
