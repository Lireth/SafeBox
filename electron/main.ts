import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { registerIpcHandlers, applyLoginItem } from './ipc'
import { initLogger } from './logger'
import { LockManager } from './lock'
import { SettingsStore } from './settings'
import { initAutoUpdater } from './updater'
import { destroyTray, initTray, registerGlobalLockShortcut, unregisterGlobalShortcuts } from './tray'
import { TRASH_RETENTION_MS, VaultStore } from './vault'

// 「正在退出」标记：before-quit 置 true，使窗口 close 拦截不再把窗口藏回托盘
// （否则托盘「退出」/ app.quit 会被 preventDefault 卡住）
let isQuitting = false

// 是否为开发模式（由 npm script 注入 VITE_DEV_SERVER_URL）
const isDev = !!process.env.VITE_DEV_SERVER_URL

// 本地数据存储：文件位于系统用户数据目录（Windows: %APPDATA%/safebox）
const store = new VaultStore(app.getPath('userData'))
// 应用锁定（PIN + 空闲自动锁定），校验串与数据文件同目录
const lock = new LockManager(app.getPath('userData'))
// 应用设置（关闭最小化到托盘等偏好），同目录 settings.json
const settings = new SettingsStore(app.getPath('userData'))

/** 回收站过期清理定时兜底间隔（毫秒，1 小时，F19） */
const TRASH_SWEEP_INTERVAL_MS = 60 * 60 * 1000

/** 主窗口引用（托盘唤起 / 关闭拦截使用） */
let mainWindow: BrowserWindow | null = null
/** 托盘是否可用（图标加载失败时禁止「关闭最小化到托盘」，避免窗口无处可去） */
let trayReady = false

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // preload 仅使用 ipcRenderer，与沙箱兼容；沙箱化可限制渲染层被攻破后的攻击面
      sandbox: true,
    },
  })

  win.on('ready-to-show', () => win.show())

  // 开启「关闭最小化到托盘」时：点 × 只隐藏窗口，进程与托盘常驻
  win.on('close', (e) => {
    if (!win.isDestroyed() && settings.settings.minimizeToTray && trayReady && !isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })

  mainWindow = win

  // 外部链接走系统默认浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL as string)
    win.webContents.openDevTools()
  } else {
    // __dirname = dist-electron/electron（rootDir 为项目根后输出按源码目录展开）
    void win.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  return win
}

// 单实例锁：第二个实例立即退出，防止多实例并发写入 vault.safebox 导致数据覆盖
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // 第二实例尝试启动时，聚焦并还原已有窗口
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    // 诊断日志层最先初始化：后续所有 console.* 进入环形缓冲并落盘（issue #35）
    initLogger(app.getPath('userData'))
    store.load()
    settings.load()
    // 物理清理回收站中超过保留期（30 天）的条目
    const purged = store.purgeExpired(TRASH_RETENTION_MS)
    if (purged > 0) console.info(`[vault] 已自动清理回收站中 ${purged} 条超期条目`)
    // 回收站过期清理定时兜底（F19）：托盘常驻用户长期不重启时，超期条目仍会被周期清理
    setInterval(() => {
      const swept = store.purgeExpired(TRASH_RETENTION_MS)
      if (swept > 0) console.info(`[vault] 已定时清理回收站中 ${swept} 条超期条目`)
    }, TRASH_SWEEP_INTERVAL_MS)
    lock.init()
    registerIpcHandlers(store, lock, settings)
    // 开机自启自愈（issue #34）：系统登录项实际状态与设置不一致时对齐
    // （覆盖用户手动删注册表键 / 应用移动导致路径失效等场景；开发模式内部跳过）
    if (app.isPackaged && app.getLoginItemSettings().openAtLogin !== settings.settings.openAtLogin) {
      applyLoginItem(settings.settings.openAtLogin)
    }
    createMainWindow()
    // 已设置 PIN 时启动即锁定，防止无人值守泄露
    lock.lock(store)
    // 空闲自动锁定：阈值取设置项 autoLockMinutes（0=永不），getter 动态读取使设置变更即时生效（O20）
    lock.startIdleMonitor(store, () => settings.settings.autoLockMinutes * 60)
    // 自动更新检查（开发环境自动跳过）
    initAutoUpdater()

    // 系统托盘：显示 / 立即锁定 / 退出（图标加载失败则托盘不可用）
    trayReady = initTray({
      onShow: showMainWindow,
      onLock: () => lock.lock(store),
    })
    // 全局 Ctrl+Alt+L：焦点在任意应用时也能一键锁定
    registerGlobalLockShortcut(() => lock.lock(store))

    app.on('activate', () => {
      // macOS: 点击 Dock 图标时若无窗口则重建
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
}

/** 托盘「显示主窗口」：还原并聚焦；窗口已关闭（未开启托盘常驻时）则重建 */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

app.on('before-quit', () => {
  // 标记正常退出，解除 close 拦截
  isQuitting = true
})

app.on('will-quit', () => {
  // 退出时注销全局快捷键并移除托盘
  unregisterGlobalShortcuts()
  destroyTray()
})

app.on('window-all-closed', () => {
  // Windows / Linux: 关闭所有窗口即退出；开启托盘常驻时窗口仅隐藏，不会走到这里
  if (process.platform !== 'darwin') app.quit()
})
