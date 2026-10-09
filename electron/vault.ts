import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { AccountEntry, EntryDraft } from './api'

/**
 * 本地数据存储：无启动密码，应用启动即加载。
 * 落盘时优先使用系统级加密（Windows DPAPI / macOS Keychain），
 * 系统加密不可用时降级为明文 JSON。
 */

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

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'vault.safebox')
  }

  /** 应用启动时加载数据（只需调用一次） */
  load(): void {
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
    } catch {
      // 旧版本主密码加密文件或损坏文件：备份后从空数据开始，保证应用可用
      try {
        fs.renameSync(this.file, `${this.file}.broken-${Date.now()}`)
      } catch {
        // 备份失败也不阻塞启动
      }
      this.entries = []
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
    this.entries.push(entry)
    this.save()
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
    this.entries[index] = updated
    this.save()
    return updated
  }

  remove(id: string): void {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.id !== id)
    if (this.entries.length === before) throw new Error('账号不存在')
    this.save()
  }

  toggleFavorite(id: string): AccountEntry {
    const entry = this.entries.find((e) => e.id === id)
    if (!entry) throw new Error('账号不存在')
    entry.favorite = !entry.favorite
    entry.updatedAt = Date.now()
    this.save()
    return entry
  }

  /** 加密并原子写入磁盘（临时文件 + 重命名） */
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
    fs.renameSync(tmp, this.file)
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
