import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import { exportEncryptedBackup } from './backup'
import { SafeBoxError } from './errors'
import type { SettingsStore } from './settings'
import type { VaultStore } from './vault'

/**
 * 定时自动备份（F23）
 * - 口令经 safeStorage 加密存于 userData/autobackup.secret（与 lock.pin 同级保护，不落明文）
 * - 调度由 main.ts 驱动（启动时 + 6h 周期）：开启 + 目录已选 + 口令已存 + 有未删除条目
 *   + 距目录内最新备份 ≥ 间隔天数 时，静默导出口令加密备份
 * - 锁定态下 VaultStore 内存已清空，天然跳过；任何失败仅记日志，绝不打扰主流程
 */

const SECRET_FILE = 'autobackup.secret'
const FILE_PREFIX = 'safebox-auto-'
const MIN_PASSWORD_LENGTH = 8

interface SecretFile {
  v: 1
  /** base64(safeStorage(password)) */
  payload: string
}

/** 设置自动备份口令（≥8 位，safeStorage 加密落盘） */
export function saveAutoBackupPassword(userDataDir: string, password: unknown): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new SafeBoxError('PASSWORD_TOO_SHORT', `口令长度至少 ${MIN_PASSWORD_LENGTH} 个字符`, { min: MIN_PASSWORD_LENGTH })
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SafeBoxError('ENCRYPTION_UNAVAILABLE', '系统加密不可用，无法保存备份口令')
  }
  const payload = safeStorage.encryptString(password).toString('base64')
  const file = path.join(userDataDir, SECRET_FILE)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, payload } satisfies SecretFile), 'utf-8')
  fs.renameSync(tmp, file)
}

/** 清除自动备份口令 */
export function clearAutoBackupPassword(userDataDir: string): void {
  try {
    fs.rmSync(path.join(userDataDir, SECRET_FILE), { force: true })
  } catch {
    // 清除失败不阻塞（下次保存会覆盖）
  }
}

/** 读取自动备份口令（未设置 / 加密不可用 / 文件损坏返回 null） */
export function loadAutoBackupPassword(userDataDir: string): string | null {
  try {
    const file = path.join(userDataDir, SECRET_FILE)
    if (!fs.existsSync(file) || !safeStorage.isEncryptionAvailable()) return null
    const meta = JSON.parse(fs.readFileSync(file, 'utf-8')) as SecretFile
    if (!meta?.payload) return null
    return safeStorage.decryptString(Buffer.from(meta.payload, 'base64'))
  } catch {
    return null
  }
}

/** 目录内最新 safebox-auto-*.json 的 mtime（无则 0） */
function lastAutoBackupAt(dir: string): number {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith('.json'))
      .map((name) => {
        try {
          return fs.statSync(path.join(dir, name)).mtimeMs
        } catch {
          return 0
        }
      })
      .reduce((max, cur) => Math.max(max, cur), 0)
  } catch {
    return 0
  }
}

/**
 * 满足条件时静默执行一次自动备份，返回是否执行（供测试与日志判断）。
 * 备份文件名 safebox-auto-YYYY-MM-DD-HH-MM-SS.json，口令加密格式与手动导出一致（可互相恢复）。
 */
export function maybeRunAutoBackup(store: VaultStore, settings: SettingsStore, userDataDir: string): boolean {
  try {
    const s = settings.settings
    if (!s.autoBackupEnabled || !s.autoBackupDir) return false
    const password = loadAutoBackupPassword(userDataDir)
    if (!password) return false
    const entries = store.list().filter((e) => !e.deletedAt)
    if (entries.length === 0) return false
    if (!fs.existsSync(s.autoBackupDir)) return false
    const last = lastAutoBackupAt(s.autoBackupDir)
    const intervalMs = (s.autoBackupDays || 7) * 24 * 60 * 60 * 1000
    if (last > 0 && Date.now() - last < intervalMs) return false
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const target = path.join(s.autoBackupDir, `${FILE_PREFIX}${stamp}.json`)
    exportEncryptedBackup(store, target, password)
    console.info(`[autobackup] 已自动备份 ${entries.length} 条到 ${path.basename(target)}`)
    return true
  } catch (err) {
    console.warn(`[autobackup] 自动备份失败: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}
