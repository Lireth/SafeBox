import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AccountEntry, EntryDraft, VaultStatus } from './api'

/**
 * 加密金库：使用主密码通过 scrypt 派生密钥，
 * 全量数据以 AES-256-GCM 加密后落盘（密文自带完整性校验）。
 */
const SCRYPT_PARAMS = {
  N: 2 ** 15, // 32768
  r: 8,
  p: 1,
  keylen: 32,
  // scrypt 默认 maxmem 不足以支撑以上参数，手动放宽
  maxmem: 128 * (2 ** 15) * 8 * 2
} as const

const IV_LENGTH = 12
const SALT_LENGTH = 16
const MAX_MASTER_PASSWORD_LENGTH = 128

/** 金库磁盘文件结构 */
interface VaultFile {
  version: number
  salt: string // base64
  cipher: string // base64(iv + ciphertext + tag)
}

/** 密文内层结构 */
interface VaultPayload {
  entries: AccountEntry[]
  savedAt: number
}

export class VaultManager {
  private readonly file: string
  private key: Buffer | null = null
  private salt: Buffer | null = null
  private entries: AccountEntry[] = []

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'vault.safebox')
  }

  /** 当前状态：未创建 → setup；已创建未解锁 → locked */
  get status(): VaultStatus {
    if (this.key) return 'unlocked'
    return fs.existsSync(this.file) ? 'locked' : 'setup'
  }

  /** 首次使用：创建金库 */
  create(masterPassword: string): void {
    if (fs.existsSync(this.file)) {
      throw new Error('金库已存在，请直接解锁')
    }
    const password = validateMasterPassword(masterPassword)
    const salt = crypto.randomBytes(SALT_LENGTH)
    this.salt = salt
    this.key = deriveKey(password, salt)
    this.entries = []
    this.save()
  }

  /** 用主密码解锁，密码错误时抛出异常 */
  unlock(masterPassword: string): void {
    const password = validateMasterPassword(masterPassword)
    let meta: VaultFile
    try {
      meta = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as VaultFile
    } catch {
      throw new Error('金库文件已损坏')
    }

    const salt = Buffer.from(meta.salt, 'base64')
    const key = deriveKey(password, salt)
    try {
      const payload = JSON.parse(decrypt(meta.cipher, key)) as VaultPayload
      this.entries = Array.isArray(payload.entries) ? payload.entries : []
      this.salt = salt
      this.key = key
    } catch {
      // GCM 认证标签校验失败 = 主密码错误
      throw new Error('主密码错误')
    }
  }

  /** 锁定：清空内存中的密钥与数据 */
  lock(): void {
    this.key = null
    this.salt = null
    this.entries = []
  }

  list(): AccountEntry[] {
    this.ensureUnlocked()
    return this.entries
  }

  add(draft: EntryDraft): AccountEntry {
    this.ensureUnlocked()
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
    this.ensureUnlocked()
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
    this.ensureUnlocked()
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.id !== id)
    if (this.entries.length === before) throw new Error('账号不存在')
    this.save()
  }

  toggleFavorite(id: string): AccountEntry {
    this.ensureUnlocked()
    const entry = this.entries.find((e) => e.id === id)
    if (!entry) throw new Error('账号不存在')
    entry.favorite = !entry.favorite
    entry.updatedAt = Date.now()
    this.save()
    return entry
  }

  private ensureUnlocked(): void {
    if (!this.key) throw new Error('金库未解锁')
  }

  /** 加密并原子写入磁盘（临时文件 + 重命名） */
  private save(): void {
    if (!this.key || !this.salt) throw new Error('金库未解锁')
    const payload: VaultPayload = { entries: this.entries, savedAt: Date.now() }
    const vaultFile: VaultFile = {
      version: 1,
      salt: this.salt.toString('base64'),
      cipher: encrypt(JSON.stringify(payload), this.key)
    }
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(vaultFile), 'utf-8')
    fs.renameSync(tmp, this.file)
  }
}

function validateMasterPassword(password: string): string {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('主密码至少需要 8 个字符')
  }
  if (password.length > MAX_MASTER_PASSWORD_LENGTH) {
    throw new Error('主密码过长')
  }
  return password
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem
  })
}

function encrypt(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, encrypted, tag]).toString('base64')
}

function decrypt(cipherB64: string, key: Buffer): string {
  const raw = Buffer.from(cipherB64, 'base64')
  const iv = raw.subarray(0, IV_LENGTH)
  const tag = raw.subarray(raw.length - 16)
  const data = raw.subarray(IV_LENGTH, raw.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8')
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
