import { Icon } from './Icon'

/** 设置/解锁共用的居中卡片布局 */
export function AuthLayout({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">
          <Icon name="shield" size={30} strokeWidth={1.8} />
        </div>
        <h1 className="auth-title">秘匣</h1>
        <p className="auth-subtitle">{subtitle}</p>
        <h2 className="visually-hidden">{title}</h2>
        {children}
      </div>
    </div>
  )
}
