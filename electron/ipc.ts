import { app, clipboard, ipcMain, shell } from 'electron'
import type { EntryDraft } from '../shared/types'
import { LockManager } from './lock'
import { VaultStore } from './vault'

/** 剪贴板自动清空时长（毫秒） */
const CLIPBOARD_CLEAR_MS = 30 * 1000

export function registerIpcHandlers(store: VaultStore, lock: LockManager): void {
  // ---- 应用状态 ----

  ipcMain.handle('app:load-status', () => store.getLoadStatus())

  ipcMain.handle('app:open-data-dir', async () => {
    // 返回空字符串表示成功，否则为平台错误信息
    const error = await shell.openPath(app.getPath('userData'))
    if (error) throw new Error(`无法打开数据目录: ${error}`)
  })

  // ---- 应用锁定 ----

  ipcMain.handle('lock:get-state', () => ({ pinEnabled: lock.pinEnabled, locked: lock.isLocked }))

  ipcMain.handle('lock:setup', (_event, oldPin: unknown, newPin: unknown) => {
    lock.setupPin(oldPin, newPin)
  })

  ipcMain.handle('lock:clear', (_event, oldPin: unknown) => {
    lock.clearPin(oldPin, store)
  })

  ipcMain.handle('lock:lock', () => {
    lock.lock(store)
  })

  ipcMain.handle('lock:unlock', (_event, pin: unknown) => {
    lock.unlock(pin, store)
  })

  // ---- 账号 CRUD（锁定期间拒绝访问数据） ----

  /** 锁定守卫：锁定态下抛错，防止敏感数据离开主进程 */
  const guard = <T>(handler: () => T): T => {
    if (lock.isLocked) throw new Error('应用已锁定，请先解锁')
    return handler()
  }

  ipcMain.handle('entries:list', () => guard(() => store.list()))

  ipcMain.handle('entries:add', (_event, draft: unknown) =>
    guard(() => store.add(draft as EntryDraft))
  )

  ipcMain.handle('entries:update', (_event, id: unknown, draft: unknown) =>
    guard(() => store.update(assertString(id, 'id'), draft as EntryDraft))
  )

  ipcMain.handle('entries:delete', (_event, id: unknown) => {
    guard(() => store.remove(assertString(id, 'id')))
  })

  ipcMain.handle('entries:toggle-favorite', (_event, id: unknown) =>
    guard(() => store.toggleFavorite(assertString(id, 'id')))
  )

  // ---- 剪贴板与外链 ----

  let clipboardTimer: NodeJS.Timeout | null = null

  ipcMain.handle('clipboard:copy', (_event, text: unknown) => {
    const value = assertString(text, '内容')
    if (lock.isLocked) throw new Error('应用已锁定，请先解锁')
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
