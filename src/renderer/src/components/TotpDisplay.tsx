import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { totpCode, totpRemainingSeconds } from '../lib/totp'
import { t, useLang } from '../lib/i18n'

interface TotpDisplayProps {
  secret: string
  period: number
  digits: number
  algorithm: 'SHA1' | 'SHA256' | 'SHA512' | undefined
  onCopy: (text: string, label: string) => void
}

/** TOTP 验证码展示：码值 + 周期倒计时环 + 一键复制（每秒本地重算，零网络；参数取自条目，F18） */
export function TotpDisplay({ secret, period, digits, algorithm, onCopy }: TotpDisplayProps): React.JSX.Element {
  useLang()
  // 时间快照与码值同帧更新，避免窗口边界处码值与倒计时短暂错位
  const [state, setState] = useState<{ now: number; code: string | null }>({ now: 0, code: null })

  useEffect(() => {
    let cancelled = false
    function tick(): void {
      void totpCode(secret, Date.now(), { period, digits, algorithm })
        .then((code) => {
          if (!cancelled) setState({ now: Date.now(), code })
        })
        .catch(() => {
          if (!cancelled) setState({ now: Date.now(), code: null })
        })
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [secret, period, digits, algorithm])

  const remaining = state.now ? totpRemainingSeconds(state.now, period) : period
  const radius = 8
  const circumference = 2 * Math.PI * radius
  const urgent = remaining <= 5

  return (
    <div className="totp-display">
      <svg
        className={`totp-ring ${urgent ? 'is-urgent' : ''}`}
        width="22"
        height="22"
        viewBox="0 0 22 22"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r={radius} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
        <circle
          cx="11"
          cy="11"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - remaining / period)}
          transform="rotate(-90 11 11)"
        />
      </svg>
      <span className="detail-value mono totp-code">
        {state.code ? `${state.code.slice(0, digits / 2)} ${state.code.slice(digits / 2)}` : '••• •••'}
      </span>
      <span className="totp-remaining">{state.now ? `${remaining}s` : ''}</span>
      {state.code && (
        <button type="button" className="icon-btn" title={t('detail.copyTotp')} onClick={() => onCopy(state.code as string, t('detail.totpCopied'))}>
          <Icon name="copy" size={15} />
        </button>
      )}
    </div>
  )
}
