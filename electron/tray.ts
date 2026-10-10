import { app, globalShortcut, Menu, Tray, nativeImage } from 'electron'
import path from 'node:path'

/**
 * 系统托盘与全局快捷键（issue #25）
 * - 托盘常驻：菜单「显示主窗口 / 立即锁定 / 退出」，单击托盘图标唤起窗口
 * - 全局 Ctrl+Alt+L：焦点在任意应用时也能一键锁定 SafeBox
 * - 图标复用打包资源 build/icon.ico（dev 时位于项目根，打包后位于 asar 内，
 *   app.getAppPath() 两种环境均可正确解析）
 */

export interface TrayCallbacks {
  /** 唤起并聚焦主窗口（窗口已销毁时应重建） */
  onShow: () => void
  /** 立即锁定（未设置 PIN 时 LockManager 内部为 no-op） */
  onLock: () => void
}

/** 全局锁定快捷键（与窗口内 Ctrl+L 并存） */
const GLOBAL_LOCK_ACCELERATOR = 'CommandOrControl+Alt+L'

let tray: Tray | null = null

/** 创建托盘图标与菜单；返回是否创建成功（图标加载失败时静默跳过，不阻塞应用启动） */
export function initTray(callbacks: TrayCallbacks): boolean {
  if (tray) return true
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.ico')
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    console.warn('[tray] 托盘图标加载失败，跳过托盘功能:', iconPath)
    return false
  }
  tray = new Tray(image)
  tray.setToolTip('秘匣 SafeBox')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => callbacks.onShow() },
      { label: '立即锁定', click: () => callbacks.onLock() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]),
  )
  // Windows 下单击托盘图标即唤起窗口（与双击习惯均兼容）
  tray.on('click', () => callbacks.onShow())
  console.info('[tray] 系统托盘已就绪')
  return true
}

/** 移除托盘（退出时调用） */
export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

/** 注册全局锁定快捷键；注册失败（被其他应用占用）时返回 false 并留日志 */
export function registerGlobalLockShortcut(onLock: () => void): boolean {
  try {
    const ok = globalShortcut.register(GLOBAL_LOCK_ACCELERATOR, onLock)
    if (ok) {
      console.info('[tray] 全局锁定快捷键 Ctrl+Alt+L 已注册')
    } else {
      console.warn(`[tray] 全局快捷键 ${GLOBAL_LOCK_ACCELERATOR} 注册失败（可能已被其他应用占用）`)
    }
    return ok
  } catch (err) {
    console.warn('[tray] 全局快捷键注册异常:', err)
    return false
  }
}

/** 注销全部全局快捷键（app will-quit 时必须调用，防止快捷键泄漏给其他进程） */
export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll()
}
