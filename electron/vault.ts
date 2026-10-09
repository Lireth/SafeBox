import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { AccountEntry, EntryDraft, LoadStatus } from '../shared/types'

/**
 * 本地数据存储：无启动密码，应用启动即加载。
 * 落盘时优先使用系统级加密（Windows DPAPI / macOS Keychain），
 * 系统加密不可用时降级为明文 JSON。
 */

/** 保存时保留的轮换备份份数 */
const MAX_BACKUPS = 3

/** 回收站保留时长：超过后自动物理清理 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 数据磁盘文件结构。
 * version 历史：v1 主密码加密（已废弃，读取失败走 broken 备份）；v2 safeStorage 加密；
 * v3 条目支持软删除（deletedAt）；v4 条目支持 TOTP 秘钥（totpSecret）。
 * v2/v3/v4 结构向后兼容：新增字段均可选且缺省视为未启用，
 * 因此 load() 不做版本拦截，旧文件升级无缝兼容。
 */
interface StoreFile {
  version: number
  /** 是否使用 safeStorage 加密 */
  encrypted: boolean
  /** encrypted=true: base64(safeStorage 密文)；false: 明文 JSON */
  payload: string
}

/** 密文/明文内层结构 */
interface StorePayload {
  entries: AccountEntry[]
  savedAt: number
}

export class VaultStore {
  private readonly file: string
  private entries: AccountEntry[] = []
  private lastLoadResult: LoadStatus = { status: 'empty' }

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'vault.safebox')
  }

  /** 启动加载状态（broken 表示文件损坏已备份，供 UI 展示警示） */
  getLoadStatus(): LoadStatus {
    return this.lastLoadResult
  }

  /** 清空内存数据（应用锁定时调用），磁盘文件不受影响 */
  clearMemory(): void {
    this.entries = []
  }

  /** 应用启动时加载数据（只需调用一次） */
  load(): void {
    this.lastLoadResult = { status: 'empty' }
    if (!fs.existsSync(this.file)) return
    try {
      const meta = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as StoreFile
      let json: string
      if (meta.encrypted) {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error('系统加密不可用')
        }
        json = safeStorage.decryptString(Buffer.from(meta.payload, 'base64'))
      } else {
        json = meta.payload
      }
      const data = JSON.parse(json) as StorePayload
      const rawEntries = Array.isArray(data.entries) ? data.entries : []
      // 逐条校验：磁盘文件可能因外部篡改或历史缺陷含格式非法条目，
      // 跳过坏条目以免击穿渲染端（如 title.charAt / f.toLowerCase 抛错），保留好条目
      const valid: AccountEntry[] = []
      let skipped = 0
      for (const raw of rawEntries) {
        const entry = normalizeEntry(raw)
        if (entry) valid.push(entry)
        else skipped++
      }
      this.entries = valid
      if (skipped > 0) {
        this.lastLoadResult = { status: 'repaired', skipped }
        console.warn(`[vault] 数据文件含 ${skipped} 条格式非法条目，已跳过并保留其余 ${valid.length} 条`)
      } else {
        this.lastLoadResult = { status: 'ok' }
      }
    } catch {
      // 旧版本主密码加密文件或损坏文件：备份后从空数据开始，并向上报告以便 UI 警示
      const backupName = `${path.basename(this.file)}.broken-${Date.now()}`
      try {
        fs.renameSync(this.file, path.join(path.dirname(this.file), backupName))
      } catch {
        // 备份失败也不阻塞启动
      }
      this.entries = []
      this.lastLoadResult = { status: 'broken', backupFile: backupName }
      console.warn(`[vault] 数据文件解析失败，已备份为 ${backupName}，本次从空数据启动`)
    }
  }

  list(): AccountEntry[] {
    return this.entries
  }

  add(draft: EntryDraft): AccountEntry {
    const now = Date.now()
    const entry: AccountEntry = {
      ...normalizeDraft(draft),
      id: crypto.randomUUID(),
      favorite: draft.favorite === true,
      createdAt: now,
      updatedAt: now,
    }
    this.commit([...this.entries, entry])
    return entry
  }

  update(id: string, draft: EntryDraft): AccountEntry {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index === -1) throw new Error('账号不存在')
    const updated: AccountEntry = {
      ...this.entries[index],
      ...normalizeDraft(draft),
      favorite: draft.favorite === true,
      updatedAt: Date.now(),
    }
    const next = [...this.entries]
    next[index] = updated
    this.commit(next)
    return updated
  }

  /**
   * 删除账号：软删除（标记 deletedAt 移入回收站）。
   * 条目保留在存储中，可经 restore() 恢复；updatedAt 不变（内容未被修改）。
   */
  remove(id: string): void {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index === -1) throw new Error('账号不存在')
    if (this.entries[index].deletedAt) return
    const next = [...this.entries]
    next[index] = { ...this.entries[index], deletedAt: Date.now() }
    this.commit(next)
  }

  /** 从回收站恢复账号（清除软删除标记），返回恢复后的条目 */
  restore(id: string): AccountEntry {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index === -1) throw new Error('账号不存在')
    if (!this.entries[index].deletedAt) throw new Error('该账号不在回收站中')
    const restored = { ...this.entries[index] }
    delete restored.deletedAt
    const next = [...this.entries]
    next[index] = restored
    this.commit(next)
    return restored
  }

  /** 彻底删除回收站中的账号（物理删除，不可恢复）；不允许绕过软删除直接物理删除 */
  purge(id: string): void {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index === -1) throw new Error('账号不存在')
    if (!this.entries[index].deletedAt) throw new Error('该账号不在回收站中')
    this.commit(this.entries.filter((e) => e.id !== id))
  }

  /**
   * 物理清理软删除超过 maxAgeMs 的条目（应用启动时调用），返回清理数量。
   * 用 >= 判断使 maxAgeMs=0 时所有已删除条目均被清理（测试与手动清空可用）。
   */
  purgeExpired(maxAgeMs: number): number {
    const now = Date.now()
    const expired = this.entries.filter((e) => typeof e.deletedAt === 'number' && now - e.deletedAt >= maxAgeMs)
    if (expired.length === 0) return 0
    const expiredIds = new Set(expired.map((e) => e.id))
    this.commit(this.entries.filter((e) => !expiredIds.has(e.id)))
    return expired.length
  }

  toggleFavorite(id: string): AccountEntry {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index === -1) throw new Error('账号不存在')
    const updated: AccountEntry = {
      ...this.entries[index],
      favorite: !this.entries[index].favorite,
      updatedAt: Date.now(),
    }
    const next = [...this.entries]
    next[index] = updated
    this.commit(next)
    return updated
  }

  /**
   * 导入合并：跳过 id 已存在的条目（不静默覆盖），
   * 全部条目经 normalizeDraft 净化后一次性原子落盘（写盘失败整体回滚）。
   * 落盘前的 backupCurrent 会自动产生一份「导入前」的完整备份。
   */
  mergeEntries(entries: AccountEntry[]): { imported: number; skipped: number } {
    const existing = new Set(this.entries.map((e) => e.id))
    const incoming: AccountEntry[] = []
    let skipped = 0
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object') {
        throw new Error('备份内容包含无效条目')
      }
      if (typeof entry.id === 'string' && existing.has(entry.id)) {
        skipped++
        continue
      }
      incoming.push(entry)
    }
    if (incoming.length === 0) return { imported: 0, skipped }

    const now = Date.now()
    const cleaned = incoming.map((entry) => ({
      id: typeof entry.id === 'string' && entry.id ? entry.id : crypto.randomUUID(),
      ...normalizeDraft(entry),
      favorite: entry.favorite === true,
      createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : now,
      updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : now,
      // 备份可能包含回收站中的条目，恢复其软删除状态（非法值视为未删除）
      deletedAt: typeof entry.deletedAt === 'number' ? entry.deletedAt : undefined,
    }))
    this.commit([...this.entries, ...cleaned])
    return { imported: cleaned.length, skipped }
  }

  /**
   * 统一写入入口：应用内存变更并持久化。
   * 写盘失败时回滚内存到变更前状态，保证内存与磁盘始终一致，
   * 避免后续操作基于「假成功」状态扩大不一致。
   * （要求所有变更以不可变方式构造 next 数组，不原地修改旧对象）
   */
  private commit(next: AccountEntry[]): void {
    const previous = this.entries
    this.entries = next
    try {
      this.save()
    } catch (err) {
      this.entries = previous
      throw err
    }
  }

  /** 加密并原子写入磁盘（临时文件 + 重命名），并轮换保留最近备份 */
  private save(): void {
    const json = JSON.stringify({ entries: this.entries, savedAt: Date.now() } satisfies StorePayload)
    let meta: StoreFile
    if (safeStorage.isEncryptionAvailable()) {
      meta = { version: 4, encrypted: true, payload: safeStorage.encryptString(json).toString('base64') }
    } else {
      meta = { version: 4, encrypted: false, payload: json }
    }
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(meta), 'utf-8')
    // 覆盖前将上一份完好数据复制为 .bak，降低误写导致的数据丢失风险
    this.backupCurrent()
    fs.renameSync(tmp, this.file)
    this.rotateBackups()
  }

  /** 将当前数据文件复制为带时间戳的 .bak 备份 */
  private backupCurrent(): void {
    try {
      if (fs.existsSync(this.file)) {
        fs.copyFileSync(this.file, `${this.file}.bak-${Date.now()}`)
      }
    } catch {
      // 备份失败不阻塞保存
    }
  }

  /** 仅保留最近 MAX_BACKUPS 份 .bak 备份，超出部分按时间删除 */
  private rotateBackups(): void {
    try {
      const dir = path.dirname(this.file)
      const base = path.basename(this.file)
      const baks = fs
        .readdirSync(dir)
        .filter((name) => name.startsWith(`${base}.bak-`))
        .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
      for (const item of baks.slice(MAX_BACKUPS)) {
        try {
          fs.unlinkSync(path.join(dir, item.name))
        } catch {
          // 单个备份删除失败可忽略
        }
      }
    } catch {
      // 轮换失败不影响主流程
    }
  }
}

/**
 * 读取侧逐条校验磁盘条目：必备字段类型不符的坏条目返回 null（由 load() 跳过计数）。
 * 与写入侧 normalizeDraft 互补：写入拒绝非法输入，读取容忍历史/外部损坏数据。
 * 可选字段（deletedAt/totpSecret）非法时仅清除该字段，不连坐整条记录。
 */
function normalizeEntry(raw: unknown): AccountEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as Record<string, unknown>
  const isStr = (v: unknown): v is string => typeof v === 'string'
  if (
    !isStr(e.id) ||
    !isStr(e.title) ||
    !isStr(e.category) ||
    !isStr(e.url) ||
    !isStr(e.username) ||
    !isStr(e.password) ||
    !isStr(e.notes) ||
    typeof e.favorite !== 'boolean' ||
    typeof e.createdAt !== 'number' ||
    typeof e.updatedAt !== 'number'
  ) {
    return null
  }
  const entry: AccountEntry = {
    id: e.id,
    title: e.title,
    category: CATEGORY_IDS.includes(e.category) ? e.category : 'other',
    url: e.url,
    username: e.username,
    password: e.password,
    notes: e.notes,
    favorite: e.favorite,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }
  if (typeof e.deletedAt === 'number') entry.deletedAt = e.deletedAt
  if (isStr(e.totpSecret) && e.totpSecret) entry.totpSecret = e.totpSecret
  return entry
}

/** 校验并规范化渲染进程提交的账号数据 */
function normalizeDraft(draft: EntryDraft): Omit<AccountEntry, 'id' | 'favorite' | 'createdAt' | 'updatedAt'> {
  if (typeof draft !== 'object' || draft === null) {
    throw new Error('数据格式错误')
  }
  const str = (value: unknown, max: number, field: string): string => {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string') throw new Error(`${field} 格式错误`)
    const trimmed = value.trim()
    if (trimmed.length > max) throw new Error(`${field}过长（最多 ${max} 字符）`)
    return trimmed
  }

  const title = str(draft.title, 100, '名称')
  if (!title) throw new Error('请填写账号名称')

  return {
    title,
    // 分类不在预置列表时归入 other
    category: CATEGORY_IDS.includes(draft.category) ? draft.category : 'other',
    url: str(draft.url, 500, '网址'),
    username: str(draft.username, 200, '用户名'),
    password: typeof draft.password === 'string' ? draft.password.slice(0, 500) : '',
    notes: str(draft.notes, 2000, '备注'),
    // TOTP 秘钥规范化为 Base32 后存储（支持 otpauth:// 链接与裸 Base32）
    totpSecret: normalizeTotp(draft.totpSecret),
  }
}

/**
 * TOTP 秘钥存储侧规范化：otpauth:// 链接提取 secret 参数，裸 Base32 做字符集校验。
 * 返回规范化 Base32（大写、无填充）；空输入返回 undefined。
 * 与渲染端 lib/totp.ts 的 parseTOTPSecret 保持一致（渲染端为完整实现，此处为存储校验）。
 */
function normalizeTotp(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string') throw new Error('TOTP 秘钥格式错误')
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (trimmed.length > 500) throw new Error('TOTP 秘钥过长')

  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    let secret: string | null
    try {
      const url = new URL(trimmed)
      if (url.protocol !== 'otpauth:' || url.host.toLowerCase() !== 'totp') throw new Error('bad type')
      secret = url.searchParams.get('secret')
    } catch {
      throw new Error('otpauth 链接格式错误（仅支持 totp 类型）')
    }
    if (!secret) throw new Error('otpauth 链接缺少 secret 参数')
    return assertBase32(secret)
  }
  return assertBase32(trimmed)
}

/** Base32 校验与规范化（存储侧） */
function assertBase32(raw: string): string {
  const compact = raw.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  if (compact.length < 8) throw new Error('TOTP 秘钥过短（至少 8 个 Base32 字符）')
  if (compact.length > 128) throw new Error('TOTP 秘钥过长')
  if (!/^[A-Z2-7]+$/.test(compact)) throw new Error('TOTP 秘钥不是有效的 Base32（仅允许 A-Z 和 2-7）')
  return compact
}

// 与渲染端 categories 保持一致，仅用于服务端校验
const CATEGORY_IDS = ['dev', 'social', 'email', 'finance', 'shopping', 'work', 'study', 'other']
