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

export type ElectronAPI = SafeBoxAPI
