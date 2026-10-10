import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportDiagnostics, getBuffer, initLogger, resetLogger, sanitize } from '../../electron/logger'

describe('logger 脱敏 sanitize', () => {
  it('键值对形式敏感值掩码（冒号/等号、大小写不敏感）', () => {
    expect(sanitize('password=hunter2')).toBe('password=***')
    expect(sanitize('PIN: 123456')).toBe('PIN=***')
    expect(sanitize('totpSecret=JBSWY3DPEHPK3PXP, retry=3')).toBe('totpSecret=***, retry=3')
    expect(sanitize('backupPassphrase = correct horse')).toContain('backupPassphrase=***')
  })

  it('长 Base32 秘钥整体掩码', () => {
    expect(sanitize('key JBSWY3DPEHPK3PXJBSWY3DPEHPK3PXP loaded')).toContain('[REDACTED-SECRET]')
  })

  it('普通诊断文本不受影响', () => {
    const text = '[vault] 数据文件解析失败，已备份为 vault.safebox.broken-1700000000000，本次从空数据启动'
    expect(sanitize(text)).toBe(text)
  })
})

describe('logger 环形缓冲与 console 劫持', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safebox-logger-'))
    resetLogger()
  })

  afterEach(() => {
    resetLogger()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('initLogger 创建 logs 目录并劫持 console：warn 进入缓冲与文件', () => {
    initLogger(tmpDir)
    console.warn('[test] 模拟告警')
    const rec = getBuffer().at(-1)
    expect(rec?.level).toBe('warn')
    expect(rec?.msg).toBe('[test] 模拟告警')
    const main = path.join(tmpDir, 'logs', 'main.log')
    expect(fs.existsSync(main)).toBe(true)
    const content = fs.readFileSync(main, 'utf-8')
    expect(content).toContain('[WARN] [test] 模拟告警')
    // 启动横幅为首条
    expect(content.split('\n')[0]).toContain('[boot] SafeBox v')
  })

  it('重复 initLogger 幂等：不叠加劫持', () => {
    initLogger(tmpDir)
    initLogger(tmpDir)
    const before = getBuffer().length
    console.info('once')
    expect(getBuffer().length).toBe(before + 1)
  })

  it('环形缓冲保留最近 500 条', () => {
    initLogger(tmpDir)
    for (let i = 0; i < 600; i++) console.info(`m${i}`)
    const buf = getBuffer()
    expect(buf.length).toBe(500)
    // 启动横幅（1 条）已被挤出，保留的是 m100..m599
    expect(buf[0].msg).toBe('m100')
    expect(buf.at(-1)?.msg).toBe('m599')
  })

  it('敏感值经劫持路径落盘前已脱敏', () => {
    initLogger(tmpDir)
    console.error('解锁失败 password=secret123 pin=9999')
    const content = fs.readFileSync(path.join(tmpDir, 'logs', 'main.log'), 'utf-8')
    expect(content).toContain('password=***')
    expect(content).not.toContain('secret123')
    expect(content).not.toContain('9999')
  })

  it('落盘按大小轮转：main.log 超限滚动为 main.1.log', () => {
    initLogger(tmpDir)
    // 每条 ~1KB，写 1200 条 > 1MB，触发轮转
    const filler = 'x'.repeat(1000)
    for (let i = 0; i < 1200; i++) console.info(filler)
    expect(fs.existsSync(path.join(tmpDir, 'logs', 'main.1.log'))).toBe(true)
    // main.log 仍存在且不超过上限太多
    const size = fs.statSync(path.join(tmpDir, 'logs', 'main.log')).size
    expect(size).toBeLessThanOrEqual(1024 * 1024 + 2048)
  })

  it('exportDiagnostics 含头部元信息与缓冲记录', () => {
    initLogger(tmpDir)
    console.warn('重要事件 A')
    console.error('重要事件 B')
    const dump = exportDiagnostics()
    expect(dump).toContain('SafeBox 诊断日志')
    expect(dump).toContain('缓冲记录: 3 条')
    expect(dump).toContain('[WARN] 重要事件 A')
    expect(dump).toContain('[ERROR] 重要事件 B')
  })

  it('logs 目录创建失败时降级为仅缓冲模式（不抛错）', () => {
    // 指向一个已存在为普通文件的父路径，mkdir 必失败
    const blocker = path.join(tmpDir, 'blocker')
    fs.writeFileSync(blocker, 'not a dir', 'utf-8')
    initLogger(path.join(blocker, 'nested'))
    console.info('buffered only')
    expect(getBuffer().at(-1)?.msg).toBe('buffered only')
  })
})
