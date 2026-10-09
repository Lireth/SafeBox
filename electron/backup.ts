import crypto from 'node:crypto'
import fs from 'node:fs'
import type { AccountEntry } from '../shared/types'
import type { VaultStore } from './vault'

/**
 * 加密备份导出 / 导入
 * - 格式：JSON（magic + version + scrypt 参数 + AES-256-GCM 密文）
 * - 口令 → scrypt(N=16384, r=8, p=1) 派生 256 位密钥，不依赖系统加密（safeStorage），
 *   因此可在换机 / 重装系统后凭口令恢复
 * - GCM 认证标签同时承担完整性校验：口令错误或密文被篡改均在解密时失败
 */

const MAGIC = 'SAFEBOX-EXPORT'
const FORMAT_VERSION = 1
const SALT_LENGTH = 16
const IV_LENGTH = 12
const KEY_LENGTH = 32
const MIN_PASSWORD_LENGTH = 8
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const

/** 备份磁盘文件结构 */
interface ExportFile {
  magic: typeof MAGIC
  version: number
  kdf: { salt: string; N: number; r: number; p: number }
  cipher: { iv: string; tag: string; data: string }
}

/** 导入结果统计 */
export interface BackupStats {
  total: number
  imported: number
  skipped: number
}

/** 将全部条目以口令加密导出到指定路径，返回导出条数 */
export function exportEncryptedBackup(store: VaultStore, targetPath: string, password: string): number {
  assertPassword(password)
  const entries = store.list()

  const salt = crypto.randomBytes(SALT_LENGTH)
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = deriveKey(password, salt)
  const aad = Buffer.from(`${MAGIC}:v${FORMAT_VERSION}`, 'utf-8')

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  cipher.setAAD(aad)
  const plaintext = JSON.stringify({ exportedAt: Date.now(), entries })
  const data = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])

  const payload: ExportFile = {
    magic: MAGIC,
    version: FORMAT_VERSION,
    kdf: { salt: salt.toString('base64'), ...SCRYPT_PARAMS },
    cipher: { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
  }

  // 原子写入：临时文件 + 重命名
  const tmp = `${targetPath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8')
  fs.renameSync(tmp, targetPath)
  return entries.length
}

/** 解密备份文件并与当前数据合并，返回统计 */
export function importEncryptedBackup(store: VaultStore, sourcePath: string, password: string): BackupStats {
  assertPassword(password)

  let parsed: ExportFile
  try {
    parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf-8')) as ExportFile
  } catch {
    throw new Error('备份文件格式错误')
  }
  if (parsed?.magic !== MAGIC || typeof parsed.version !== 'number') {
    throw new Error('不是有效的 SafeBox 加密备份文件')
  }
  if (parsed.version > FORMAT_VERSION) {
    throw new Error('备份文件版本过新，请先升级应用')
  }

  let entries: AccountEntry[]
  try {
    const key = deriveKey(password, Buffer.from(parsed.kdf.salt, 'base64'))
    const aad = Buffer.from(`${MAGIC}:v${parsed.version}`, 'utf-8')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.cipher.iv, 'base64'), {
      authTagLength: 16
    })
    decipher.setAAD(aad)
    decipher.setAuthTag(Buffer.from(parsed.cipher.tag, 'base64'))
    const plaintext = Buffer.concat([decipher.update(Buffer.from(parsed.cipher.data, 'base64')), decipher.final()])
    const inner = JSON.parse(plaintext.toString('utf-8')) as { entries?: unknown }
    if (!Array.isArray(inner.entries)) throw new Error('备份内容无效')
    entries = inner.entries as AccountEntry[]
  } catch {
    // 统一口令错误提示，不泄露具体失败环节
    throw new Error('口令错误或备份文件已损坏')
  }

  const result = store.mergeEntries(entries)
  return { total: entries.length, ...result }
}

function assertPassword(password: string): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`口令长度至少 ${MIN_PASSWORD_LENGTH} 个字符`)
  }
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LENGTH, {
    ...SCRYPT_PARAMS,
    maxmem: 64 * 1024 * 1024
  })
}
