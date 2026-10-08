import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'

// 是否为开发模式（由 npm script 注入 VITE_DEV_SERVER_URL）
const isDev = !!process.env.VITE_DEV_SERVER_URL

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
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
  createMainWindow()

  app.on('activate', () => {
    // macOS: 点击 Dock 图标时若无窗口则重建
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  // Windows / Linux: 关闭所有窗口即退出
  if (process.platform !== 'darwin') app.quit()
})
