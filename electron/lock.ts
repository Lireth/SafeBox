import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, powerMonitor, safeStorage } from 'electron'
import type { VaultStore } from './vault'

/**
 * 应用锁定（一期：会话级锁定）
 * - PIN 校验串 = safeStorage 加密的 SHA-256 摘要，磁盘与内存均不存明文 PIN
 * - 锁定时机：启动即锁（已设 PIN 时）/ 手动锁定 / 系统空闲超时
 * - 锁定态：清空 VaultStore 内存数据，数据类 IPC 在 ipc.ts 侧统一拒绝
 */

/** 系统空闲自动锁定阈值（秒） */
const IDLE_LOCK_SECONDS = 5 * 60
/** 系统空闲检测轮询间隔（毫秒） */
const IDLE_POLL_MS = 10 * 1000
/** PIN 长度限制 */
const PIN_MIN = 4
const PIN_MAX = 32

/** PIN 校验串磁盘文件结构 */
interface PinFile {
  v: 1
  /** base64(safeStorage(SHA-256(PIN) hex)) */
  payload: string
}

export class LockManager {
  private readonly file: string
  /** SHA-256 hex 摘要；null 表示未设置 PIN */
  private pinHash: string | null = null
  private locked = false
  private pollTimer: NodeJS.Timeout | null = null

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'lock.pin')
  }

  get pinEnabled(): boolean {
    return this.pinHash !== null
  }

  get isLocked(): boolean {
    return this.locked
  }

  /** 启动时读取 PIN 校验串（只需调用一次） */
  init(): void {
    this.pinHash = null
    try {
      if (!fs.existsSync(this.file)) return
      const meta = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as PinFile
      if (!meta?.payload || !safeStorage.isEncryptionAvailable()) return
      this.pinHash = safeStorage.decryptString(Buffer.from(meta.payload, 'base64'))
    } catch {
      // 校验串损坏：视为未设置并清理坏文件，避免锁死
      try {
        fs.unlinkSync(this.file)
      } catch {
        // 清理失败不阻塞启动
      }
      this.pinHash = null
    }
  }

  /** 设置 / 修改 PIN（已启用时需验证旧 PIN） */
  setupPin(oldPin: unknown, newPin: unknown): void {
    if (this.pinHash !== null) {
      if (typeof oldPin !== 'string' || this.hash(oldPin) !== this.pinHash) {
        throw new Error('当前 PIN 不正确')
      }
    }
    const pin = typeof newPin === 'string' ? newPin.trim() : ''
    if (pin.length < PIN_MIN || pin.length > PIN_MAX) {
      throw new Error(`PIN 长度需为 ${PIN_MIN}-${PIN_MAX} 个字符`)
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统加密不可用，无法设置锁定 PIN')
    }
    const payload = safeStorage.encryptString(this.hash(pin)).toString('base64')
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, payload } satisfies PinFile), 'utf-8')
    fs.renameSync(tmp, this.file)
    this.pinHash = this.hash(pin)
  }

  /** 清除锁定（需验证旧 PIN），同时解锁并重载数据 */
  clearPin(oldPin: unknown, store: VaultStore): void {
    if (this.pinHash === null) throw new Error('尚未设置锁定 PIN')
    if (typeof oldPin !== 'string' || this.hash(oldPin) !== this.pinHash) {
      throw new Error('PIN 不正确')
    }
    try {
      fs.unlinkSync(this.file)
    } catch {
      // 删除失败不阻塞流程
    }
    this.pinHash = null
    if (this.locked) {
      this.locked = false
      store.load()
      this.broadcast(false)
    }
  }

  /** 进入锁定态：清空主进程内存并广播 */
  lock(store: VaultStore): void {
    if (this.locked || !this.pinEnabled) return
    this.locked = true
    store.clearMemory()
    console.info('[lock] 应用已进入锁定态')
    this.broadcast(true)
  }

  /** 校验 PIN 并解锁，成功后重载数据并广播 */
  unlock(pin: unknown, store: VaultStore): void {
    if (!this.locked) return
    if (this.pinHash === null) throw new Error('尚未设置锁定 PIN')
    if (typeof pin !== 'string' || this.hash(pin) !== this.pinHash) {
      throw new Error('PIN 不正确')
    }
    this.locked = false
    store.load()
    this.broadcast(false)
  }

  /** 启动系统空闲轮询：空闲超过阈值自动锁定 */
  startIdleMonitor(store: VaultStore): void {
    this.stopIdleMonitor()
    this.pollTimer = setInterval(() => {
      if (this.locked || !this.pinEnabled) return
      try {
        if (powerMonitor.getSystemIdleTime() >= IDLE_LOCK_SECONDS) {
          this.lock(store)
        }
      } catch {
        // 单次轮询异常忽略
      }
    }, IDLE_POLL_MS)
  }

  stopIdleMonitor(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private hash(input: string): string {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
  }

  /** 向渲染端广播锁定状态变化 */
  private broadcast(locked: boolean): void {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('lock:changed', locked)
    }
  }
}
