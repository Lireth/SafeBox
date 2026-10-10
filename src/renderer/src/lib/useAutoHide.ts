import { useCallback, useEffect, useState } from 'react'

/**
 * 密码明文可见时长（毫秒），到期自动隐藏；与剪贴板 30 秒清空同属「限时暴露」模型（issue #26）。
 * 此前为模块级常量散落在 EntryDetailModal，随 useAutoHide hook 收编（O25）。
 */
export const PASSWORD_VISIBLE_MS = 15_000

/**
 * 「限时暴露」状态 hook（O25 收编）：每次从隐藏变为可见时（重新）启动定时器，
 * 到期自动隐藏；隐藏 / 卸载即清理定时器。
 * 此前主密码与历史密码行各有一份 effect 实现（issue #26 曾统一常量但逻辑仍是两份），
 * 收编为单一 hook 后行为一致且全部回调引用稳定（useCallback），不会造成定时器异常重置。
 */
export function useAutoHide(): {
  /** 当前是否可见 */
  visible: boolean
  /** 显示并（重新）启动超时计时 */
  show: () => void
  /** 立即隐藏 */
  hide: () => void
  /** 显示 / 隐藏切换 */
  toggle: () => void
} {
  const [visible, setVisible] = useState(false)
  const show = useCallback(() => setVisible(true), [])
  const hide = useCallback(() => setVisible(false), [])
  const toggle = useCallback(() => setVisible((v) => !v), [])
  useEffect(() => {
    if (!visible) return
    const timer = window.setTimeout(hide, PASSWORD_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [visible, hide])
  return { visible, show, hide, toggle }
}
