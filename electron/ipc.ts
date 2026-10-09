import { clipboard, ipcMain, shell } from 'electron'
import type { EntryDraft } from './api'
import { VaultStore } from './vault'

/** 剪贴板自动清空时长（毫秒） */
const CLIPBOARD_CLEAR_MS = 30 * 1000

export function registerIpcHandlers(store: VaultStore): void {
  // ---- 账号 CRUD ----

  ipcMain.handle('entries:list', () => store.list())

  ipcMain.handle('entries:add', (_event, draft: unknown) => store.add(draft as EntryDraft))

  ipcMain.handle('entries:update', (_event, id: unknown, draft: unknown) => {
    return store.update(assertString(id, 'id'), draft as EntryDraft)
  })

  ipcMain.handle('entries:delete', (_event, id: unknown) => {
    store.remove(assertString(id, 'id'))
  })

  ipcMain.handle('entries:toggle-favorite', (_event, id: unknown) => {
    return store.toggleFavorite(assertString(id, 'id'))
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
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field}格式错误`)
  return value
}
