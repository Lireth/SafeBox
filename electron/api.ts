import { ipcRenderer } from 'electron'

// ============================================================
// 类型定义（主进程与渲染进程共享，渲染端仅做 type-only 引入）
// ============================================================

/** 一条账号记录 */
export interface AccountEntry {
  id: string
  /** 名称，如 GitHub、公司邮箱 */
  title: string
  /** 分类 id，见渲染端 CATEGORIES */
  category: string
  /** 网址 */
  url: string
  /** 用户名 / 手机号 / 邮箱 */
  username: string
  /** 密码 */
  password: string
  /** 备注 */
  notes: string
  favorite: boolean
  createdAt: number
  updatedAt: number
}

/** 新增 / 编辑时由渲染端提交的数据 */
export type EntryDraft = Pick<AccountEntry, 'title' | 'category' | 'url' | 'username' | 'password' | 'notes'> & {
  favorite?: boolean
}

export interface SafeBoxAPI {
  /** 列出所有账号 */
  listEntries(): Promise<AccountEntry[]>
  addEntry(draft: EntryDraft): Promise<AccountEntry>
  updateEntry(id: string, draft: EntryDraft): Promise<AccountEntry>
  deleteEntry(id: string): Promise<void>
  toggleFavorite(id: string): Promise<AccountEntry>
  /** 复制到系统剪贴板（主进程侧，30 秒后自动清空） */
  copyText(text: string): Promise<void>
  /** 用系统默认浏览器打开网址（仅允许 http/https） */
  openExternal(url: string): Promise<void>
}

// ============================================================
// 预加载端实现
// ============================================================

const INVOKE_CHANNELS = new Set([
  'entries:list',
  'entries:add',
  'entries:update',
  'entries:delete',
  'entries:toggle-favorite',
  'clipboard:copy',
  'app:open-external'
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
  addEntry: (draft) => invoke<AccountEntry>('entries:add', draft),
  updateEntry: (id, draft) => invoke<AccountEntry>('entries:update', id, draft),
  deleteEntry: (id) => invoke('entries:delete', id),
  toggleFavorite: (id) => invoke<AccountEntry>('entries:toggle-favorite', id),
  copyText: (text) => invoke('clipboard:copy', text),
  openExternal: (url) => invoke('app:open-external', url)
}

export type ElectronAPI = SafeBoxAPI
