import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { registerIpcHandlers } from './ipc'
import { VaultManager } from './vault'

// 是否为开发模式（由 npm script 注入 VITE_DEV_SERVER_URL）
const isDev = !!process.env.VITE_DEV_SERVER_URL

// 加密金库：数据文件存放在系统用户数据目录（Windows: %APPDATA%/safebox）
const vault = new VaultManager(app.getPath('userData'))

function createMainWindow(): void {
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
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 外部链接走系统默认浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL as string)
    win.webContents.openDevTools()
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers(vault, () => BrowserWindow.getAllWindows()[0] ?? null)
  createMainWindow()

  app.on('activate', () => {
    // macOS: 点击 Dock 图标时若无窗口则重建
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  // Windows / Linux: 关闭所有窗口即退出（退出前清空内存中的密钥）
  vault.lock()
  if (process.platform !== 'darwin') app.quit()
})
