import { Modal } from './Modal'
import { getHotkeyList } from '../lib/hotkeys'
import { t } from '../lib/i18n'

/** 快捷键帮助弹窗（Ctrl+/ 打开） */
export function HotkeyHelpModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Modal title={t('hotkeys.title')} onClose={onClose}>
      <div className="hotkey-list">
        {getHotkeyList().map((item) => (
          <div key={item.keys} className="hotkey-row">
            <span className="hotkey-keys">{item.keys}</span>
            <span className="hotkey-desc">{item.desc}</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
