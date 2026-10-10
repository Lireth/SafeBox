import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, powerMonitor, safeStorage } from 'electron'
import type { UnlockResult } from '../shared/types'
import { SafeBoxError } from './errors'
import type { VaultStore } from './vault'

/**
 * 应用锁定（一期：会话级锁定）
 * - PIN 校验串 = safeStorage 加密的摘要，磁盘与内存均不存明文 PIN；
 *   v2 起摘要为 scrypt 加盐派生（O33），v1（单轮 SHA-256）历史文件在首次校验成功后静默升级
 * - 锁定时机：启动即锁（已设 PIN 时）/ 手动锁定 / 系统空闲超时
 * - 锁定态：清空 VaultStore 内存数据，数据类 IPC 在 ipc.ts 侧统一拒绝
 * - 暴力破解防护：解锁连续失败达阈值后指数退避（冷却期内不校验摘要），
 *   计数与退避仅存内存（重启重置，但重启后仍面对启动即锁）
 * - 敏感操作前置校验（verifyPin）独立限速（O29）：不消耗解锁配额，
 *   但连续失败同样进入独立冷却，封堵绕过解锁退避的枚举旁路
 * - 锁定转场钩子（O30）：进入锁定态时同步执行附加动作（如剪贴板收口）
 */

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
  /** v1: SHA-256 单轮摘要（历史版本）；v2: scrypt 加盐摘要（O33） */
  v: 1 | 2
  /** v1: base64(safeStorage(SHA-256(PIN) hex))；v2: base64(safeStorage(scrypt(PIN, salt) hex)) */
  payload: string
  /** v2 专有：KDF 盐（base64） */
  salt?: string
}

export class LockManager {
  private readonly file: string
  /** 当前生效的 PIN 摘要（hex）；null 表示未设置 PIN */
  private pinHash: string | null = null
  /** 摘要算法：sha256（v1 历史文件）| scrypt（v2，O33） */
  private pinKdf: 'sha256' | 'scrypt' = 'sha256'
  /** scrypt 盐（v2 专有；pinKdf=scrypt 时恒非空） */
  private pinSalt: Buffer | null = null
  private locked = false
  private pollTimer: NodeJS.Timeout | null = null
  /** 解锁连续失败次数（成功解锁 / 清除 PIN / 重新锁定后重置） */
  private failCount = 0
  /** 退避冷却截止时间戳（毫秒）；0 表示无冷却 */
  private cooldownUntil = 0
  /** verifyPin 独立失败计数（O29）：与解锁退避相互独立 */
  private verifyFailCount = 0
  /** verifyPin 独立冷却截止时间戳（毫秒）；0 表示无冷却 */
  private verifyCooldownUntil = 0
  /** 锁定转场附加动作（O30：剪贴板收口等），lock() 实际进入锁定态时同步调用 */
  private lockHooks: Array<() => void> = []
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
    this.pinKdf = 'sha256'
    this.pinSalt = null
    try {
      if (!fs.existsSync(this.file)) return
      const meta = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as PinFile
      if (!meta?.payload || !safeStorage.isEncryptionAvailable()) return
      this.pinHash = safeStorage.decryptString(Buffer.from(meta.payload, 'base64'))
      if (meta.v === 2 && meta.salt) {
        this.pinKdf = 'scrypt'
        this.pinSalt = Buffer.from(meta.salt, 'base64')
      }
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

  /** 设置 / 修改 PIN（已启用时需验证旧 PIN）；恒以 v2（scrypt 加盐）落盘 */
  setupPin(oldPin: unknown, newPin: unknown): void {
    if (this.pinHash !== null) {
      if (!this.matches(oldPin)) {
        throw new SafeBoxError('PIN_WRONG_CURRENT', '当前 PIN 不正确')
      }
    }
    const pin = typeof newPin === 'string' ? newPin.trim() : ''
    if (pin.length < PIN_MIN || pin.length > PIN_MAX) {
      throw new SafeBoxError('PIN_LENGTH', `PIN 长度需为 ${PIN_MIN}-${PIN_MAX} 个字符`, { min: PIN_MIN, max: PIN_MAX })
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new SafeBoxError('ENCRYPTION_UNAVAILABLE', '系统加密不可用，无法设置锁定 PIN')
    }
    this.persistPin(pin)
  }

  /** 清除锁定（需验证旧 PIN），同时解锁并重载数据 */
  clearPin(oldPin: unknown, store: VaultStore): void {
    if (this.pinHash === null) throw new SafeBoxError('NO_PIN_SET', '尚未设置锁定 PIN')
    if (!this.matches(oldPin)) {
      throw new SafeBoxError('PIN_WRONG', 'PIN 不正确')
    }
    try {
      fs.unlinkSync(this.file)
    } catch {
      // 删除失败不阻塞流程
    }
    this.pinHash = null
    this.pinKdf = 'sha256'
    this.pinSalt = null
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
    // verifyPin 独立配额随锁定会话重置（O29）
    this.verifyFailCount = 0
    this.verifyCooldownUntil = 0
    store.clearMemory()
    // 锁定转场附加动作（O30：剪贴板收口等），在广播前完成；单点失败不阻塞锁定
    for (const hook of this.lockHooks) {
      try {
        hook()
      } catch {
        // 忽略：锁定本身不可被附加动作失败阻断
      }
    }
    console.info('[lock] 应用已进入锁定态')
    this.broadcast(true)
  }

  /** 注册锁定转场回调（实际进入锁定态时同步执行；已锁定时的重复 lock 不再触发） */
  onLock(hook: () => void): void {
    this.lockHooks.push(hook)
  }

  /**
   * 无副作用校验 PIN（明文 CSV 导出等敏感操作前的二次身份确认，issue #32）。
   * 不改变锁定态、不消耗解锁退避配额；PIN 错误抛中文错误。
   * O29 独立限速：本方法原设计不限速，但「无配额」意味着可绕过解锁退避
   * 高频枚举短 PIN——连续失败达阈值后进入独立冷却（与 unlock 退避互不占用），
   * 校验成功（证明知晓 PIN，排除爆破嫌疑）即重置独立计数。
   */
  verifyPin(pin: unknown): void {
    if (this.pinHash === null) return // 未设置 PIN：无需校验（调用方以 pinEnabled 区分）
    if (Date.now() < this.verifyCooldownUntil) {
      const remainSec = Math.ceil((this.verifyCooldownUntil - Date.now()) / 1000)
      throw new SafeBoxError('PIN_RATE_LIMITED', `尝试过于频繁，请 ${remainSec} 秒后再试`, { seconds: remainSec })
    }
    if (!this.matches(pin)) {
      this.verifyFailCount++
      if (this.verifyFailCount >= MAX_UNLOCK_ATTEMPTS) {
        this.verifyCooldownUntil = Date.now() + Math.min(
          BASE_COOLDOWN_MS * 2 ** (this.verifyFailCount - MAX_UNLOCK_ATTEMPTS),
          MAX_COOLDOWN_MS,
        )
      }
      throw new SafeBoxError('PIN_WRONG', 'PIN 不正确')
    }
    // 校验成功：重置独立计数（冷却随时间自然到期，无需主动清除）；v1 摘要顺路升级
    this.verifyFailCount = 0
    if (typeof pin === 'string') this.upgradeDigest(pin)
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
    if (!this.matches(pin)) {
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
    // 成功解锁证明知晓 PIN：verifyPin 独立配额一并重置（O29）；v1 摘要顺路升级（O33）
    this.verifyFailCount = 0
    this.verifyCooldownUntil = 0
    if (typeof pin === 'string') this.upgradeDigest(pin)
    store.load()
    this.broadcast(false)
    return { ok: true }
  }

  /**
   * 启动锁定监控：
   * 1. powerMonitor 'lock-screen' 事件（Windows/macOS）——系统锁屏瞬间立即锁定
   *    （独立于空闲阈值：系统锁屏是明确的离开信号，autoLockMinutes=0 也不豁免）
   * 2. 空闲轮询兜底（Linux 无 lock-screen 事件；Windows 快速用户切换等边缘场景）
   *    阈值由 getIdleSeconds 动态提供（O20：设置项 autoLockMinutes × 60，0=永不），
   *    每次轮询读取，设置变更无需重启监控即时生效。
   */
  startIdleMonitor(store: VaultStore, getIdleSeconds: () => number): void {
    this.stopIdleMonitor()
    this.pollTimer = setInterval(() => {
      if (this.locked || !this.pinEnabled) return
      try {
        const limit = getIdleSeconds()
        if (limit > 0 && powerMonitor.getSystemIdleTime() >= limit) {
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

  /** v1 摘要：单轮 SHA-256（无盐）；仅在读取历史 v1 文件时使用 */
  private hash(input: string): string {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
  }

  /**
   * v2 摘要：scrypt 加盐（O33）。参数与加密备份（backup.ts）一致（N=16384, r=8, p=1），
   * 单次派生约 50ms——解锁/校验体感无差别；而 lock.pin 被同用户态恶意进程解开
   * （DPAPI 被绕过）后，短 PIN 的离线穷举成本提升数个数量级。
   */
  private scryptHex(input: string, salt: Buffer): string {
    return crypto.scryptSync(input, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex')
  }

  /** 当前摘要算法下的 PIN 校验（unlock / verifyPin / clearPin / setupPin 旧值共用） */
  private matches(pin: unknown): boolean {
    if (typeof pin !== 'string' || this.pinHash === null) return false
    if (this.pinKdf === 'scrypt') return this.scryptHex(pin, this.pinSalt as Buffer) === this.pinHash
    return this.hash(pin) === this.pinHash
  }

  /** 以 v2（scrypt 加盐）写入校验串并更新内存状态（setupPin / upgradeDigest 共用） */
  private persistPin(pin: string): void {
    const salt = crypto.randomBytes(16)
    const digest = this.scryptHex(pin, salt)
    const payload = safeStorage.encryptString(digest).toString('base64')
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ v: 2, payload, salt: salt.toString('base64') } satisfies PinFile), 'utf-8')
    fs.renameSync(tmp, this.file)
    this.pinHash = digest
    this.pinKdf = 'scrypt'
    this.pinSalt = salt
  }

  /**
   * v1 → v2 静默升级（O33）：任一 PIN 校验成功后调用，改用 scrypt 加盐重新落盘。
   * 失败保持 v1 摘要继续生效（下次校验成功再试），绝不影响本次校验结果。
   */
  private upgradeDigest(pin: string): void {
    if (this.pinKdf === 'scrypt' || !safeStorage.isEncryptionAvailable()) return
    try {
      this.persistPin(pin)
    } catch {
      // 升级失败不阻塞：v1 校验串仍有效
    }
  }

  /** 向渲染端广播锁定状态变化 */
  private broadcast(locked: boolean): void {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('lock:changed', locked)
    }
  }
}
