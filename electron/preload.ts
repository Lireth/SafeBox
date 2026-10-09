import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AccountEntry, EntryDraft, LoadStatus, LockState, SafeBoxAPI } from '../shared/types'

// ============================================================
// 预加载端实现
// ============================================================
// 注意：沙箱模式下 preload 无法 require 本地模块（如 ./api），
// 实现必须内联在本文件，仅允许对共享类型做 type-only 引入
// （编译后擦除，不产生 require）。

const INVOKE_CHANNELS = new Set([
  'entries:list',
  'entries:add',
  'entries:update',
  'entries:delete',
  'entries:toggle-favorite',
  'clipboard:copy',
  'app:open-external',
  'app:load-status',
  'app:open-data-dir',
  'lock:get-state',
  'lock:setup',
  'lock:clear',
  'lock:lock',
  'lock:unlock'
])

/** invoke 封装：白名单校验 + 还原主进程抛出的真实错误信息 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!INVOKE_CHANNELS.has(channel)) {
    throw new Error(`不允许的 IPC 通道: ${channel}`)
  }
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Electron 包装格式："Error invoking remote method 'xxx': Error: 真实信息"
    const match = message.match(/Error invoking remote method '[^']+': (?:Error: )?([\s\S]*)$/)
    throw new Error(match ? match[1] : message)
  }
}

export const electronAPI: SafeBoxAPI = {
  listEntries: () => invoke<AccountEntry[]>('entries:list'),
  getLoadStatus: () => invoke<LoadStatus>('app:load-status'),
  getLockState: () => invoke<LockState>('lock:get-state'),
  setupLockPin: (oldPin, newPin) => invoke('lock:setup', oldPin, newPin),
  clearLockPin: (oldPin) => invoke('lock:clear', oldPin),
  lockNow: () => invoke('lock:lock'),
  unlockApp: (pin) => invoke('lock:unlock', pin),
  onLockChanged: (listener) => {
    const wrapped = (_event: IpcRendererEvent, locked: boolean): void => listener(locked)
    ipcRenderer.on('lock:changed', wrapped)
    return () => ipcRenderer.removeListener('lock:changed', wrapped)
  },
  addEntry: (draft) => invoke<AccountEntry>('entries:add', draft),
  updateEntry: (id, draft) => invoke<AccountEntry>('entries:update', id, draft),
  deleteEntry: (id) => invoke('entries:delete', id),
  toggleFavorite: (id) => invoke<AccountEntry>('entries:toggle-favorite', id),
  copyText: (text) => invoke('clipboard:copy', text),
  openExternal: (url) => invoke('app:open-external', url),
  openDataDir: () => invoke('app:open-data-dir')
}

export type ElectronAPI = SafeBoxAPI

// 通过 contextBridge 暴露类型化的安全 API
contextBridge.exposeInMainWorld('safebox', electronAPI)
