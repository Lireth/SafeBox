import { clipboard, ipcMain, shell, type BrowserWindow } from 'electron'
import type { EntryDraft, VaultStatus } from './api'
import { VaultManager } from './vault'

/** 无操作自动锁定时长（毫秒） */
const AUTO_LOCK_MS = 10 * 60 * 1000
/** 剪贴板自动清空时长（毫秒） */
const CLIPBOARD_CLEAR_MS = 30 * 1000

export function registerIpcHandlers(vault: VaultManager, getWindow: () => BrowserWindow | null): void {
  // ---- 金库状态 ----

  ipcMain.handle('vault:get-status', () => {
    touchActivity()
    return vault.status
  })

  ipcMain.handle('vault:create', (_event, masterPassword: unknown) => {
    vault.create(assertString(masterPassword, '主密码'))
    broadcastStatus(getWindow(), vault.status)
  })

  ipcMain.handle('vault:unlock', (_event, masterPassword: unknown) => {
    vault.unlock(assertString(masterPassword, '主密码'))
    broadcastStatus(getWindow(), vault.status)
  })

  ipcMain.handle('vault:lock', () => {
    vault.lock()
    broadcastStatus(getWindow(), vault.status)
  })

  // ---- 账号 CRUD ----

  ipcMain.handle('vault:list-entries', () => {
    touchActivity()
    return vault.list()
  })

  ipcMain.handle('vault:add-entry', (_event, draft: unknown) => {
    touchActivity()
    return vault.add(draft as EntryDraft)
  })

  ipcMain.handle('vault:update-entry', (_event, id: unknown, draft: unknown) => {
    touchActivity()
    return vault.update(assertString(id, 'id'), draft as EntryDraft)
  })

  ipcMain.handle('vault:delete-entry', (_event, id: unknown) => {
    touchActivity()
    vault.remove(assertString(id, 'id'))
  })

  ipcMain.handle('vault:toggle-favorite', (_event, id: unknown) => {
    touchActivity()
    return vault.toggleFavorite(assertString(id, 'id'))
  })

  // ---- 剪贴板与外链 ----

  let clipboardTimer: NodeJS.Timeout | null = null

  ipcMain.handle('clipboard:copy', (_event, text: unknown) => {
    const value = assertString(text, '内容')
    if (!value) return
    clipboard.writeText(value)
    // 到期后若剪贴板内容未被覆盖，则自动清空，降低敏感信息残留风险
    if (clipboardTimer) clearTimeout(clipboardTimer)
    clipboardTimer = setTimeout(() => {
      clipboardTimer = null
      if (clipboard.readText() === value) clipboard.writeText('')
    }, CLIPBOARD_CLEAR_MS)
  })

  ipcMain.handle('app:open-external', (_event, url: unknown) => {
    const value = assertString(url, '网址')
    if (!value) return
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw new Error('网址格式错误')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('仅允许打开 http/https 链接')
    }
    void shell.openExternal(parsed.toString())
  })

  // ---- 无操作自动锁定 ----

  let lastActivity = Date.now()

  function touchActivity(): void {
    lastActivity = Date.now()
  }

  setInterval(() => {
    if (vault.status === 'unlocked' && Date.now() - lastActivity > AUTO_LOCK_MS) {
      vault.lock()
      broadcastStatus(getWindow(), vault.status)
    }
  }, 30 * 1000)
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field}格式错误`)
  return value
}

function broadcastStatus(win: BrowserWindow | null, status: VaultStatus): void {
  win?.webContents.send('vault:status-changed', status)
}
