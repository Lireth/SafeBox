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

/** 数据磁盘文件结构 */
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
      this.entries = Array.isArray(data.entries) ? data.entries : []
      this.lastLoadResult = { status: 'ok' }
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
      updatedAt: now
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
      updatedAt: Date.now()
    }
    const next = [...this.entries]
    next[index] = updated
    this.commit(next)
    return updated
  }

  remove(id: string): void {
    const next = this.entries.filter((e) => e.id !== id)
    if (next.length === this.entries.length) throw new Error('账号不存在')
    this.commit(next)
  }

  toggleFavorite(id: string): AccountEntry {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index === -1) throw new Error('账号不存在')
    const updated: AccountEntry = {
      ...this.entries[index],
      favorite: !this.entries[index].favorite,
      updatedAt: Date.now()
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
      updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : now
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
      meta = { version: 2, encrypted: true, payload: safeStorage.encryptString(json).toString('base64') }
    } else {
      meta = { version: 2, encrypted: false, payload: json }
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
    notes: str(draft.notes, 2000, '备注')
  }
}

// 与渲染端 categories 保持一致，仅用于服务端校验
const CATEGORY_IDS = ['dev', 'social', 'email', 'finance', 'shopping', 'work', 'study', 'other']
