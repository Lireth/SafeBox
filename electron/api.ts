// ============================================================
// 类型定义（主进程与渲染进程共享，渲染端仅做 type-only 引入）
// 注意：本文件必须保持零运行时依赖 —— 沙箱 preload 仅允许
// type-only 引入本文件，运行时代码一律不得放此处。
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

/** 应用数据加载状态（broken 时渲染端展示持久警示条） */
export interface LoadStatus {
  status: 'ok' | 'empty' | 'broken'
  /** status=broken 时，损坏文件的自动备份文件名（位于用户数据目录） */
  backupFile?: string
}

/** 应用锁定状态 */
export interface LockState {
  /** 是否已设置锁定 PIN */
  pinEnabled: boolean
  /** 当前是否处于锁定态 */
  locked: boolean
}

export interface SafeBoxAPI {
  /** 列出所有账号 */
  listEntries(): Promise<AccountEntry[]>
  /** 获取启动时数据加载状态（broken 表示文件损坏已自动备份） */
  getLoadStatus(): Promise<LoadStatus>
  /** 获取应用锁定状态 */
  getLockState(): Promise<LockState>
  /** 设置 / 修改锁定 PIN（已启用时需验证旧 PIN） */
  setupLockPin(oldPin: string | undefined, newPin: string): Promise<void>
  /** 清除锁定 PIN（需验证旧 PIN） */
  clearLockPin(oldPin: string): Promise<void>
  /** 立即锁定（需已设置 PIN） */
  lockNow(): Promise<void>
  /** 校验 PIN 并解锁 */
  unlockApp(pin: string): Promise<void>
  /** 订阅锁定状态变化，返回取消订阅函数 */
  onLockChanged(listener: (locked: boolean) => void): () => void
  addEntry(draft: EntryDraft): Promise<AccountEntry>
  updateEntry(id: string, draft: EntryDraft): Promise<AccountEntry>
  deleteEntry(id: string): Promise<void>
  toggleFavorite(id: string): Promise<AccountEntry>
  /** 复制到系统剪贴板（主进程侧，30 秒后自动清空） */
  copyText(text: string): Promise<void>
  /** 用系统默认浏览器打开网址（仅允许 http/https） */
  openExternal(url: string): Promise<void>
  /** 在系统文件管理器中打开用户数据目录（定位备份文件） */
  openDataDir(): Promise<void>
}

export type ElectronAPI = SafeBoxAPI
