import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { registerIpcHandlers } from './ipc'
import { LockManager } from './lock'
import { VaultStore } from './vault'

// 是否为开发模式（由 npm script 注入 VITE_DEV_SERVER_URL）
const isDev = !!process.env.VITE_DEV_SERVER_URL

// 本地数据存储：文件位于系统用户数据目录（Windows: %APPDATA%/safebox）
const store = new VaultStore(app.getPath('userData'))
// 应用锁定（PIN + 空闲自动锁定），校验串与数据文件同目录
const lock = new LockManager(app.getPath('userData'))

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
    store.load()
    lock.init()
    registerIpcHandlers(store, lock)
    createMainWindow()
    // 已设置 PIN 时启动即锁定，防止无人值守泄露
    lock.lock(store)
    lock.startIdleMonitor(store)

    app.on('activate', () => {
      // macOS: 点击 Dock 图标时若无窗口则重建
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  // Windows / Linux: 关闭所有窗口即退出
  if (process.platform !== 'darwin') app.quit()
})
