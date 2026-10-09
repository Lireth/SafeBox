import { Modal } from './Modal'
import { HOTKEY_LIST } from '../lib/hotkeys'

/** 快捷键帮助弹窗（Ctrl+/ 打开） */
export function HotkeyHelpModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Modal title="快捷键" onClose={onClose}>
      <div className="hotkey-list">
        {HOTKEY_LIST.map((item) => (
          <div key={item.keys} className="hotkey-row">
            <span className="hotkey-keys">{item.keys}</span>
            <span className="hotkey-desc">{item.desc}</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
