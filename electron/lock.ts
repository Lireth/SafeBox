import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, powerMonitor, safeStorage } from 'electron'
import type { UnlockResult } from '../shared/types'
import type { VaultStore } from './vault'

/**
 * 应用锁定（一期：会话级锁定）
 * - PIN 校验串 = safeStorage 加密的 SHA-256 摘要，磁盘与内存均不存明文 PIN
 * - 锁定时机：启动即锁（已设 PIN 时）/ 手动锁定 / 系统空闲超时
 * - 锁定态：清空 VaultStore 内存数据，数据类 IPC 在 ipc.ts 侧统一拒绝
 * - 暴力破解防护：解锁连续失败达阈值后指数退避（冷却期内不校验摘要），
 *   计数与退避仅存内存（重启重置，但重启后仍面对启动即锁）
 */

/** 系统空闲自动锁定阈值（秒） */
const IDLE_LOCK_SECONDS = 5 * 60
/**
 * 系统空闲检测轮询间隔（毫秒）。
 * 仅作兜底：Windows/macOS 的即时锁定由 powerMonitor 'lock-screen' 事件覆盖（issue #27），
 * Linux 无该事件，保留轮询；30 秒间隔在「锁定延迟可接受」与「后台 CPU 占用」间取平衡。
 */
const IDLE_POLL_MS = 30 * 1000
/** PIN 长度限制 */
const PIN_MIN = 4
const PIN_MAX = 32
/** 触发退避的解锁连续失败次数阈值 */
const MAX_UNLOCK_ATTEMPTS = 5
/** 首次退避时长（毫秒），此后每失败一次翻倍 */
const BASE_COOLDOWN_MS = 30 * 1000
/** 退避时长上限（毫秒） */
const MAX_COOLDOWN_MS = 5 * 60 * 1000

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
  /** 解锁连续失败次数（成功解锁 / 清除 PIN / 重新锁定后重置） */
  private failCount = 0
  /** 退避冷却截止时间戳（毫秒）；0 表示无冷却 */
  private cooldownUntil = 0
  /** powerMonitor 'lock-screen' 事件监听器（注册后保留引用以便移除） */
  private lockScreenHandler: (() => void) | null = null

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

  /** 进入锁定态：清空主进程内存并广播；重置失败计数（每次锁定会话独立配额） */
  lock(store: VaultStore): void {
    if (this.locked || !this.pinEnabled) return
    this.locked = true
    this.failCount = 0
    this.cooldownUntil = 0
    store.clearMemory()
    console.info('[lock] 应用已进入锁定态')
    this.broadcast(true)
  }

  /**
   * 无副作用校验 PIN（明文 CSV 导出等敏感操作前的二次身份确认，issue #32）。
   * 不改变锁定态、不消耗解锁退避配额；PIN 错误抛中文错误。
   */
  verifyPin(pin: unknown): void {
    if (this.pinHash === null) return // 未设置 PIN：无需校验（调用方以 pinEnabled 区分）
    if (typeof pin !== 'string' || this.hash(pin) !== this.pinHash) {
      throw new Error('PIN 不正确')
    }
  }

  /**
   * 校验 PIN 并解锁，返回结构化结果（O18：渲染端按 code 渲染本地化文案，
   * 不再解析中文错误消息——英文界面下退避倒计时曾因此失效）。
   * 退避检查先于摘要比对：冷却期内不消耗校验，也不泄露「PIN 是否正确」。
   */
  unlock(pin: unknown, store: VaultStore): UnlockResult {
    // 未锁定时无操作（幂等）：视为已处于解锁状态
    if (!this.locked) return { ok: true }
    if (this.pinHash === null) return { ok: false, code: 'NO_PIN' }
    if (this.cooldownUntil > 0) {
      const remainMs = this.cooldownUntil - Date.now()
      if (remainMs > 0) {
        return { ok: false, code: 'COOLDOWN', retryAfterMs: remainMs }
      }
      // 冷却到期：仅清除冷却标记，保留 failCount 使后续失败退避翻倍
      this.cooldownUntil = 0
    }
    if (typeof pin !== 'string' || this.hash(pin) !== this.pinHash) {
      this.failCount++
      if (this.failCount >= MAX_UNLOCK_ATTEMPTS) {
        // 第 5 次失败退避 30s，第 6 次 60s……封顶 5 分钟
        const backoff = Math.min(BASE_COOLDOWN_MS * 2 ** (this.failCount - MAX_UNLOCK_ATTEMPTS), MAX_COOLDOWN_MS)
        this.cooldownUntil = Date.now() + backoff
        return { ok: false, code: 'COOLDOWN', retryAfterMs: backoff }
      }
      return { ok: false, code: 'PIN_WRONG' }
    }
    this.locked = false
    this.failCount = 0
    this.cooldownUntil = 0
    store.load()
    this.broadcast(false)
    return { ok: true }
  }

  /**
   * 启动锁定监控：
   * 1. powerMonitor 'lock-screen' 事件（Windows/macOS）——系统锁屏瞬间立即锁定
   * 2. 空闲轮询兜底（Linux 无 lock-screen 事件；Windows 快速用户切换等边缘场景）
   */
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
    // 事件路径无轮询的 locked 前置短路，lock() 自身幂等（已锁定直接返回）
    this.lockScreenHandler = () => this.lock(store)
    try {
      powerMonitor.on('lock-screen', this.lockScreenHandler)
      console.info('[lock] 已监听系统锁屏事件（lock-screen），锁屏即时锁定')
    } catch {
      // 极端环境（如 headless 测试外）事件不可用：仅依赖轮询兜底
      this.lockScreenHandler = null
    }
  }

  stopIdleMonitor(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.lockScreenHandler) {
      try {
        powerMonitor.removeListener('lock-screen', this.lockScreenHandler)
      } catch {
        // 移除失败忽略
      }
      this.lockScreenHandler = null
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
