// ============================================================
// 跨端共享类型契约（主进程与渲染进程唯一的类型权威来源）
// 规则：
// 1. 本目录必须保持零运行时依赖，仅允许 interface / type 声明
// 2. 沙箱 preload 仅允许 type-only 引入本目录（编译后擦除）
// 3. 渲染端不得从 electron/ 目录引入任何内容
// ============================================================

/** 一条历史密码记录（修改密码时保留旧值，供回查） */
export interface PasswordHistoryItem {
  password: string
  /** 旧密码的失效时间（即本次修改发生的时间） */
  changedAt: number
}

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
  /** 软删除时间戳；缺省 / undefined 视为未删除（兼容旧版本数据文件） */
  deletedAt?: number
  /** TOTP 双因素秘钥（规范化 Base32）；缺省表示未启用双因素 */
  totpSecret?: string
  /** 历史密码（最近 5 条，新→旧）；缺省表示从未修改过密码 */
  passwordHistory?: PasswordHistoryItem[]
}

/** 新增 / 编辑时由渲染端提交的数据 */
export type EntryDraft = Pick<AccountEntry, 'title' | 'category' | 'url' | 'username' | 'password' | 'notes'> & {
  favorite?: boolean
  /** TOTP 秘钥原始输入：otpauth:// 链接或裸 Base32，落盘前由主进程规范化 */
  totpSecret?: string
}

/** 应用数据加载状态（broken/repaired 时渲染端展示持久警示条） */
export interface LoadStatus {
  /**
   * - ok：正常加载
   * - empty：无数据文件
   * - broken：整体文件损坏/无法解密，已备份后从空数据开始
   * - repaired：文件可解析，但含格式非法的条目，已跳过坏条目、保留好条目
   */
  status: 'ok' | 'empty' | 'broken' | 'repaired'
  /** status=broken 时，损坏文件的自动备份文件名（位于用户数据目录） */
  backupFile?: string
  /** status=repaired 时，被跳过的损坏条目数 */
  skipped?: number
}

/** 应用锁定状态 */
export interface LockState {
  /** 是否已设置锁定 PIN */
  pinEnabled: boolean
  /** 当前是否处于锁定态 */
  locked: boolean
}

/** 应用设置（主进程持久化于 userData/settings.json，非敏感数据） */
export interface AppSettings {
  /** 关闭主窗口时最小化到系统托盘；false（默认）保持「关闭窗口即退出」 */
  minimizeToTray: boolean
  /** 界面语言：auto 跟随系统（默认），或手动覆盖为 zh / en（issue #33） */
  language: 'auto' | 'zh' | 'en'
  /** 开机自动启动（注册系统登录项）；false（默认），尊重系统启动项管控（issue #34） */
  openAtLogin: boolean
}

/** 加密备份导出结果（用户在系统对话框取消时 canceled=true） */
export interface BackupExportResult {
  canceled: boolean
  /** 保存路径（取消时缺省） */
  path?: string
  /** 导出条数（取消时缺省） */
  count?: number
}

/** 加密备份导入结果（用户在系统对话框取消时 canceled=true） */
export interface BackupImportResult {
  canceled: boolean
  /** 文件内总条数 */
  total?: number
  /** 新增条数 */
  imported?: number
  /** 因 id 已存在而跳过的条数 */
  skipped?: number
}

/** CSV 导入结果（从第三方密码管理器迁移；取消时 canceled=true） */
export interface CsvImportResult {
  canceled: boolean
  /** 解析出的有效行数（映射阶段，去重前） */
  total?: number
  /** 实际新增条数 */
  imported?: number
  /** 因与已有条目同名同账号而跳过的条数 */
  skipped?: number
  /** 因缺少名称被忽略的行数 */
  invalid?: number
}

/** 明文 CSV 导出结果（数据可携带性；取消时 canceled=true，不产生文件） */
export interface CsvExportResult {
  canceled: boolean
  /** 保存路径（取消时缺省） */
  path?: string
  /** 导出条数（不含回收站条目） */
  count?: number
}

/** 诊断日志导出结果（日志已脱敏；取消时 canceled=true，不产生文件） */
export interface DiagnosticsExportResult {
  canceled: boolean
  /** 保存路径（取消时缺省） */
  path?: string
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
  /** 读取应用设置（关闭最小化到托盘等偏好） */
  getSettings(): Promise<AppSettings>
  /** 局部更新应用设置，返回落盘后的完整设置 */
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  /** 获取系统区域设置（如 zh-CN / en-US），供渲染端「跟随系统」语言检测（issue #33） */
  getLocale(): Promise<string>
  /** 导出加密备份（弹出系统保存对话框，口令 + AES-256-GCM） */
  exportEncryptedBackup(password: string): Promise<BackupExportResult>
  /** 导入加密备份（弹出系统打开对话框，导入前自动备份当前数据） */
  importEncryptedBackup(password: string): Promise<BackupImportResult>
  /** 从第三方密码管理器导出的 CSV 文件导入（弹出系统打开对话框，按名称+用户名去重） */
  importCsv(): Promise<CsvImportResult>
  /** 导出明文 CSV（数据可携带性；渲染端已强确认，主进程校验 PIN 后弹出保存对话框） */
  exportCsv(pin: string | undefined): Promise<CsvExportResult>
  /** 订阅更新就绪事件（新版本已下载），返回取消订阅函数 */
  onUpdateReady(listener: (info: { version: string }) => void): () => void
  /** 立即重启并安装已下载的更新 */
  installUpdate(): Promise<void>
  addEntry(draft: EntryDraft): Promise<AccountEntry>
  updateEntry(id: string, draft: EntryDraft): Promise<AccountEntry>
  /** 删除账号（软删除，移入回收站，30 天后自动清除） */
  deleteEntry(id: string): Promise<void>
  /** 从回收站恢复账号（清除软删除标记） */
  restoreEntry(id: string): Promise<AccountEntry>
  /** 彻底删除回收站中的账号（物理删除，无法恢复） */
  purgeEntry(id: string): Promise<void>
  toggleFavorite(id: string): Promise<AccountEntry>
  /** 复制到系统剪贴板（主进程侧，30 秒后自动清空） */
  copyText(text: string): Promise<void>
  /** 用系统默认浏览器打开网址（仅允许 http/https） */
  openExternal(url: string): Promise<void>
  /** 在系统文件管理器中打开用户数据目录（定位备份文件） */
  openDataDir(): Promise<void>
  /** 导出诊断日志（弹出系统保存对话框；日志经脱敏，锁定态也可导出）（issue #35） */
  exportDiagnostics(): Promise<DiagnosticsExportResult>
}

export type ElectronAPI = SafeBoxAPI
