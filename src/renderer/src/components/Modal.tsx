import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { t, useLang } from '../lib/i18n'

interface ModalProps {
  title?: string
  /** 无标题行弹窗的可访问名称（aria-label，O21）；title 与 ariaLabel 至少提供一个 */
  ariaLabel?: string
  onClose: () => void
  children: React.ReactNode
  /** 宽度变体 */
  wide?: boolean
}

/** 可聚焦元素选择器（focus trap 遍历用；排除容器自身的 tabindex=-1 与禁用元素） */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 通用弹窗外壳：遮罩 + Esc/点击遮罩关闭 + 焦点圈定（O21） */
export function Modal({ title, ariaLabel, onClose, children, wide = false }: ModalProps): React.JSX.Element {
  useLang()
  const dialogRef = useRef<HTMLDivElement>(null)
  /** 打开弹窗前的焦点元素（卸载时归还） */
  const restoreRef = useRef<HTMLElement | null>(null)
  // 标题元素 id：惰性初始化保证实例唯一且不在 render 期产生副作用
  const [titleId] = useState(() => `modal-title-${Math.random().toString(36).slice(2, 10)}`)

  // 记录打开前的焦点元素，卸载时归还（触发元素可能已被卸载，需检查 isConnected）
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null
    return () => {
      const el = restoreRef.current
      if (el && el.isConnected) el.focus()
    }
  }, [])

  // 初始聚焦：子组件 effect 先于本 effect 执行（如 EntryFormModal 聚焦标题输入框、
  // PinSetupModal 聚焦 PIN 框），弹窗内已有焦点则不覆盖；否则聚焦弹窗容器（tabIndex=-1），
  // 保证键盘起点在弹窗内而非底层页面
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      // focus trap：Tab / Shift+Tab 在弹窗内循环，焦点被程序性移出时强制拉回
      const dialog = dialogRef.current
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusables.length === 0) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const current = document.activeElement
      if (!dialog.contains(current)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && current === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && current === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
      >
        {title && (
          <div className="modal-header">
            <h3 id={titleId} className="modal-title">
              {title}
            </h3>
            <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
