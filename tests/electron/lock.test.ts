import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LockManager } from '../../electron/lock'
import { VaultStore } from '../../electron/vault'
import { mockState } from '../mocks/electron'

describe('LockManager', () => {
  let tmpDir: string
  let store: VaultStore
  let lock: LockManager

  beforeEach(() => {
    // 静音锁定 / 数据降级的生产日志
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safebox-lock-'))
    store = new VaultStore(tmpDir)
    store.load()
    lock = new LockManager(tmpDir)
    lock.init()
    mockState.idleSeconds = 0
  })

  afterEach(() => {
    lock.stopIdleMonitor()
    vi.useRealTimers()
    vi.restoreAllMocks()
    mockState.idleSeconds = 0
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('PIN 生命周期', () => {
    it('初始未设置 PIN', () => {
      expect(lock.pinEnabled).toBe(false)
      expect(lock.isLocked).toBe(false)
    })

    it('设置 PIN 后生效并创建校验串文件', () => {
      lock.setupPin(undefined, '123456')
      expect(lock.pinEnabled).toBe(true)
      expect(fs.existsSync(path.join(tmpDir, 'lock.pin'))).toBe(true)
    })

    it('重新初始化（模拟重启）可读取校验串', () => {
      lock.setupPin(undefined, '123456')
      const rebooted = new LockManager(tmpDir)
      rebooted.init()
      expect(rebooted.pinEnabled).toBe(true)
    })

    it('修改 PIN 需验证旧 PIN', () => {
      lock.setupPin(undefined, '123456')
      expect(() => lock.setupPin('000000', '654321')).toThrow('不正确')
      lock.setupPin('123456', '654321')
      // 新 PIN 生效：旧 PIN 解锁失败
      lock.lock(store)
      expect(() => lock.unlock('123456', store)).toThrow('不正确')
      lock.unlock('654321', store)
      expect(lock.isLocked).toBe(false)
    })

    it('清除 PIN 需验证旧 PIN，成功后删除校验串文件', () => {
      lock.setupPin(undefined, '123456')
      expect(() => lock.clearPin('000000', store)).toThrow('不正确')
      lock.clearPin('123456', store)
      expect(lock.pinEnabled).toBe(false)
      expect(fs.existsSync(path.join(tmpDir, 'lock.pin'))).toBe(false)
    })

    it('PIN 长度需在 4-32 之间', () => {
      expect(() => lock.setupPin(undefined, '123')).toThrow('长度')
      expect(() => lock.setupPin(undefined, 'x'.repeat(33))).toThrow('长度')
    })

    it('校验串损坏时降级为未设置且清理坏文件', () => {
      lock.setupPin(undefined, '123456')
      // 破坏密文（去掉 mock 加密前缀使解密失败）
      const file = path.join(tmpDir, 'lock.pin')
      const meta = JSON.parse(fs.readFileSync(file, 'utf-8'))
      meta.payload = Buffer.from('bad-cipher', 'utf-8').toString('base64')
      fs.writeFileSync(file, JSON.stringify(meta), 'utf-8')

      const rebooted = new LockManager(tmpDir)
      rebooted.init()
      expect(rebooted.pinEnabled).toBe(false)
      expect(fs.existsSync(file)).toBe(false)
    })
  })

  describe('锁定与解锁', () => {
    it('锁定后主进程内存清空，重复锁定幂等', () => {
      lock.setupPin(undefined, '123456')
      store.add({ title: 'T1', category: 'other', url: '', username: '', password: '', notes: '' })
      lock.lock(store)
      expect(lock.isLocked).toBe(true)
      expect(store.list()).toEqual([])
      lock.lock(store)
      expect(lock.isLocked).toBe(true)
    })

    it('错误 PIN 拒绝解锁且保持锁定', () => {
      lock.setupPin(undefined, '123456')
      lock.lock(store)
      expect(() => lock.unlock('999999', store)).toThrow('不正确')
      expect(lock.isLocked).toBe(true)
    })

    it('正确 PIN 解锁并从磁盘重载数据', () => {
      store.add({ title: 'T1', category: 'other', url: '', username: '', password: '', notes: '' })
      lock.setupPin(undefined, '123456')
      lock.lock(store)
      expect(store.list()).toEqual([])
      lock.unlock('123456', store)
      expect(lock.isLocked).toBe(false)
      expect(store.list()).toHaveLength(1)
      expect(store.list()[0].title).toBe('T1')
    })

    it('未设置 PIN 时锁定不生效', () => {
      lock.lock(store)
      expect(lock.isLocked).toBe(false)
    })

    it('未设置 PIN 时解锁为无操作（防御分支，正常流程不可达）', () => {
      lock.unlock('123456', store)
      expect(lock.isLocked).toBe(false)
    })
  })

  describe('解锁暴力破解防护（指数退避）', () => {
    /** 锁定并连续失败 n 次，返回各次错误消息 */
    function failNTimes(n: number): string[] {
      const messages: string[] = []
      for (let i = 0; i < n; i++) {
        try {
          lock.unlock('000000', store)
        } catch (err) {
          messages.push(err instanceof Error ? err.message : '')
        }
      }
      return messages
    }

    function lockWithPin(): void {
      lock.setupPin(undefined, '123456')
      lock.lock(store)
    }

    it('前 4 次失败提示「PIN 不正确」，第 5 次触发 30 秒退避', () => {
      lockWithPin()
      const messages = failNTimes(5)
      expect(messages.slice(0, 4)).toEqual(Array(4).fill('PIN 不正确'))
      expect(messages[4]).toContain('失败次数过多')
      expect(messages[4]).toContain('30 秒')
    })

    it('冷却期内即使提交正确 PIN 也被拒绝且不解锁', () => {
      lockWithPin()
      failNTimes(5)
      expect(() => lock.unlock('123456', store)).toThrow('请')
      expect(lock.isLocked).toBe(true)
    })

    it('连续失败翻倍退避（第 6 次 60 秒），冷却期正确 PIN 也被拒', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      lockWithPin()
      failNTimes(5) // 30s
      // 冷却期内尝试不消耗退避计数
      try {
        lock.unlock('000000', store)
      } catch {
        /* 冷却拒绝 */
      }
      vi.advanceTimersByTime(30_001)
      failNTimes(1) // 第 6 次真实失败 → 60s
      expect(() => lock.unlock('123456', store)).toThrow('60 秒后重试')
      vi.advanceTimersByTime(60_001)
      // 冷却到期后正确 PIN 解锁成功
      lock.unlock('123456', store)
      expect(lock.isLocked).toBe(false)
      vi.useRealTimers()
    })

    it('成功解锁重置失败计数', () => {
      lockWithPin()
      failNTimes(4)
      lock.unlock('123456', store)
      // 重新锁定后配额重置：再失败 4 次不触发退避
      lock.lock(store)
      const messages = failNTimes(4)
      expect(messages[3]).toBe('PIN 不正确')
    })

    it('退避翻倍封顶 5 分钟（第 9 次失败为 300 秒）', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      lockWithPin()
      // 依次经历 30/60/120/240 秒退避，第 9 次失败按 480 秒计算但封顶 300 秒
      const steps = [30_001, 60_001, 120_001, 240_001]
      failNTimes(5) // 第 5 次 → 30s
      for (const ms of steps) {
        vi.advanceTimersByTime(ms)
        failNTimes(1)
      }
      expect(() => lock.unlock('000000', store)).toThrow('请 300 秒后重试')
      vi.advanceTimersByTime(300_001)
      // 封顶后继续失败保持 300 秒，不再增长
      failNTimes(1)
      expect(() => lock.unlock('000000', store)).toThrow('请 300 秒后重试')
      vi.useRealTimers()
    })
  })

  describe('系统空闲自动锁定', () => {
    function startMonitor(): void {
      lock.setupPin(undefined, '123456')
      store.add({ title: 'T1', category: 'other', url: '', username: '', password: '', notes: '' })
      // 仅 fake 定时器，保持 Date.now 真实（备份文件名依赖时间戳）
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      lock.startIdleMonitor(store)
    }

    it('空闲超过阈值（5 分钟）自动锁定', () => {
      startMonitor()
      mockState.idleSeconds = 301
      vi.advanceTimersByTime(10_500)
      expect(lock.isLocked).toBe(true)
      expect(store.list()).toEqual([])
    })

    it('空闲未超阈值不锁定', () => {
      startMonitor()
      mockState.idleSeconds = 10
      vi.advanceTimersByTime(21_000)
      expect(lock.isLocked).toBe(false)
      expect(store.list()).toHaveLength(1)
    })

    it('已锁定时空闲轮询不重复触发', () => {
      startMonitor()
      mockState.idleSeconds = 301
      vi.advanceTimersByTime(10_500)
      expect(lock.isLocked).toBe(true)
      // 持续空闲不再触发广播/清空等副作用
      vi.advanceTimersByTime(60_000)
      expect(lock.isLocked).toBe(true)
    })
  })
})
