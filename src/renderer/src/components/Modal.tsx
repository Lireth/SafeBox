import { useEffect } from 'react'
import { Icon } from './Icon'

interface ModalProps {
  title?: string
  onClose: () => void
  children: React.ReactNode
  /** 宽度变体 */
  wide?: boolean
}

/** 通用弹窗外壳：遮罩 + Esc/点击遮罩关闭 */
export function Modal({ title, onClose, children, wide = false }: ModalProps): React.JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        {title && (
          <div className="modal-header">
            <h3 className="modal-title">{title}</h3>
            <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
