import { ipcRenderer } from 'electron'

// ============================================================
// 类型定义（主进程与渲染进程共享，渲染端仅做 type-only 引入）
// ============================================================

export type VaultStatus = 'setup' | 'locked' | 'unlocked'

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
  /** 密码（金库内加密存储） */
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
  /** 获取金库当前状态 */
  getStatus(): Promise<VaultStatus>
  /** 首次使用：设置主密码并创建金库 */
  createVault(masterPassword: string): Promise<void>
  /** 解锁金库 */
  unlock(masterPassword: string): Promise<void>
  /** 锁定金库 */
  lock(): Promise<void>
  /** 列出所有账号（需已解锁） */
  listEntries(): Promise<AccountEntry[]>
  addEntry(draft: EntryDraft): Promise<AccountEntry>
  updateEntry(id: string, draft: EntryDraft): Promise<AccountEntry>
  deleteEntry(id: string): Promise<void>
  toggleFavorite(id: string): Promise<AccountEntry>
  /** 复制到系统剪贴板（主进程侧，30 秒后自动清空） */
  copyText(text: string): Promise<void>
  /** 用系统默认浏览器打开网址（仅允许 http/https） */
  openExternal(url: string): Promise<void>
  /** 订阅金库状态变化（如自动锁定），返回取消订阅函数 */
  onStatusChanged(callback: (status: VaultStatus) => void): () => void
}

// ============================================================
// 预加载端实现
// ============================================================

const INVOKE_CHANNELS = new Set([
  'vault:get-status',
  'vault:create',
  'vault:unlock',
  'vault:lock',
  'vault:list-entries',
  'vault:add-entry',
  'vault:update-entry',
  'vault:delete-entry',
  'vault:toggle-favorite',
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
  getStatus: () => invoke<VaultStatus>('vault:get-status'),
  createVault: (masterPassword) => invoke('vault:create', masterPassword),
  unlock: (masterPassword) => invoke('vault:unlock', masterPassword),
  lock: () => invoke('vault:lock'),
  listEntries: () => invoke<AccountEntry[]>('vault:list-entries'),
  addEntry: (draft) => invoke<AccountEntry>('vault:add-entry', draft),
  updateEntry: (id, draft) => invoke<AccountEntry>('vault:update-entry', id, draft),
  deleteEntry: (id) => invoke('vault:delete-entry', id),
  toggleFavorite: (id) => invoke<AccountEntry>('vault:toggle-favorite', id),
  copyText: (text) => invoke('clipboard:copy', text),
  openExternal: (url) => invoke('app:open-external', url),
  onStatusChanged: (callback) => {
    const listener = (_event: unknown, status: VaultStatus): void => callback(status)
    ipcRenderer.on('vault:status-changed', listener)
    return () => ipcRenderer.removeListener('vault:status-changed', listener)
  }
}

export type ElectronAPI = SafeBoxAPI
