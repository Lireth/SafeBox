import { Modal } from './Modal'
import { Icon } from './Icon'

interface ConfirmModalProps {
  title: string
  message: string
  confirmText?: string
  onConfirm: () => void
  onCancel: () => void
}

/** 危险操作确认弹窗 */
export function ConfirmModal({ title, message, confirmText = '删除', onConfirm, onCancel }: ConfirmModalProps): React.JSX.Element {
  return (
    <Modal onClose={onCancel}>
      <div className="confirm-body">
        <div className="confirm-icon">
          <Icon name="trash" size={20} />
        </div>
        <h3 className="confirm-title">{title}</h3>
        <p className="confirm-message">{message}</p>
        <div className="modal-actions center">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  )
}
