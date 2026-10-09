import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * 自动更新（GitHub Releases 通道）
 * - 策略：启动与每 4 小时检查一次，发现新版本静默下载，退出时自动安装；
 *   下载完成后广播渲染端展示「立即重启更新」横幅
 * - 校验：electron-updater 默认校验 latest.yml 中的 sha512 与签名信息
 * - 降级：检查 / 下载失败仅记录日志（不打扰用户），由下次轮询自然重试
 */

const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000

export function initAutoUpdater(): void {
  // 开发环境无 app-update.yml，直接跳过
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = console

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[probe] handler: allWindows =', BrowserWindow.getAllWindows().length)
    console.info(`[updater] 新版本 ${info.version} 已下载，退出时自动安装`)
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:available', { version: info.version })
    }
  })

  autoUpdater.on('error', (err) => {
    console.warn(`[updater] 更新流程异常: ${err.message}`)
  })

  void checkNow()
  setInterval(() => void checkNow(), POLL_INTERVAL_MS)
}

/** 立即检查一次更新（失败静默降级） */
export async function checkNow(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // 静默降级：不打扰用户，由下次轮询重试
  }
}

/** 退出并安装已下载的更新（渲染端「立即重启更新」触发） */
export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
