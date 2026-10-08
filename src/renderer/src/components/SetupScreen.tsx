import { useState } from 'react'
import { Icon } from './Icon'
import { AuthLayout } from './AuthLayout'
import { passwordStrength } from '../lib/password'

interface SetupScreenProps {
  onSetup: (masterPassword: string) => Promise<void>
}

/** 首次使用：设置主密码 */
export function SetupScreen({ onSetup }: SetupScreenProps): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const strength = passwordStrength(password)
  const canSubmit = password.length >= 8 && password === confirm && !busy

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (password.length < 8) {
      setError('主密码至少需要 8 个字符')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSetup(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="创建您的秘匣"
      subtitle="设置一个主密码，用于加密保护所有账号数据"
    >
      <form onSubmit={(e) => void handleSubmit(e)}>
        <label className="field-label" htmlFor="setup-password">
          主密码
        </label>
        <input
          id="setup-password"
          className="input"
          type="password"
          placeholder="至少 8 个字符"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {password && (
          <div className="strength">
            <div className="strength-bars">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className={`strength-bar s${strength.score} ${i <= strength.score ? 'on' : ''}`} />
              ))}
            </div>
            <span className="strength-label">{strength.label}</span>
          </div>
        )}

        <label className="field-label" htmlFor="setup-confirm">
          确认主密码
        </label>
        <input
          id="setup-confirm"
          className="input"
          type="password"
          placeholder="再次输入主密码"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        {error && <p className="form-error">{error}</p>}

        <button className="btn btn-primary btn-block" type="submit" disabled={!canSubmit}>
          创建金库
        </button>

        <p className="form-warning">
          <Icon name="shield" size={14} />
          主密码是唯一凭证，无法找回或重置，请务必牢记
        </p>
      </form>
    </AuthLayout>
  )
}
