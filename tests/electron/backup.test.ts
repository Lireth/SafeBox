import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportEncryptedBackup, importEncryptedBackup } from '../../electron/backup'
import { VaultStore } from '../../electron/vault'
import type { EntryDraft } from '../../shared/types'
import { safeStorage } from '../mocks/electron'

const PWD = 'password123'

function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return { title: 'T', category: 'other', url: '', username: '', password: '', notes: '', ...overrides }
}

describe('加密备份导出 / 导入', () => {
  let srcDir: string
  let dstDir: string
  let srcStore: VaultStore
  let dstStore: VaultStore
  let backupFile: string

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safebox-bak-src-'))
    dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safebox-bak-dst-'))
    srcStore = new VaultStore(srcDir)
    srcStore.load()
    dstStore = new VaultStore(dstDir)
    dstStore.load()
    backupFile = path.join(dstDir, 'backup.json')
    // 源库准备三条数据
    srcStore.add(draft({ title: 'GitHub', category: 'dev', username: 'u1', password: 'p1' }))
    srcStore.add(draft({ title: '邮箱', category: 'email', username: 'u2' }))
    srcStore.add(draft({ title: '银行', category: 'finance', favorite: true }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(srcDir, { recursive: true, force: true })
    fs.rmSync(dstDir, { recursive: true, force: true })
  })

  it('导出 → 导入完整往返，条目字段一致', () => {
    const count = exportEncryptedBackup(srcStore, backupFile, PWD)
    expect(count).toBe(3)
    expect(fs.existsSync(backupFile)).toBe(true)

    const stats = importEncryptedBackup(dstStore, backupFile, PWD)
    expect(stats).toEqual({ total: 3, imported: 3, skipped: 0 })

    const restored = dstStore.list()
    expect(restored).toHaveLength(3)
    const github = restored.find((e) => e.title === 'GitHub')
    expect(github?.username).toBe('u1')
    expect(github?.password).toBe('p1')
    expect(github?.category).toBe('dev')
    // favorite 与时间戳保留
    expect(restored.find((e) => e.title === '银行')?.favorite).toBe(true)
  })

  it('导出文件不含明文', () => {
    exportEncryptedBackup(srcStore, backupFile, PWD)
    const raw = fs.readFileSync(backupFile, 'utf-8')
    expect(raw).not.toContain('GitHub')
    expect(raw).toContain('"magic": "SAFEBOX-EXPORT"')
  })

  it('口令错误导入失败且有明确报错', () => {
    exportEncryptedBackup(srcStore, backupFile, PWD)
    expect(() => importEncryptedBackup(dstStore, backupFile, 'wrongpass9')).toThrow('口令错误或备份文件已损坏')
    // 失败不产生任何条目
    expect(dstStore.list()).toEqual([])
  })

  it('密文被篡改时导入失败', () => {
    exportEncryptedBackup(srcStore, backupFile, PWD)
    const meta = JSON.parse(fs.readFileSync(backupFile, 'utf-8'))
    const data = Buffer.from(meta.cipher.data, 'base64')
    data[0] ^= 0xff
    meta.cipher.data = data.toString('base64')
    const tampered = path.join(dstDir, 'tampered.json')
    fs.writeFileSync(tampered, JSON.stringify(meta), 'utf-8')
    expect(() => importEncryptedBackup(dstStore, tampered, PWD)).toThrow('口令错误或备份文件已损坏')
  })

  it('非 SafeBox 备份文件被拒绝', () => {
    fs.writeFileSync(backupFile, '{"hello":"world"}', 'utf-8')
    expect(() => importEncryptedBackup(dstStore, backupFile, PWD)).toThrow('不是有效的 SafeBox 加密备份文件')
  })

  it('口令过短拒绝导出', () => {
    expect(() => exportEncryptedBackup(srcStore, backupFile, 'short1')).toThrow('至少 8 个字符')
  })

  it('重复导入按 id 跳过，不覆盖已有条目', () => {
    exportEncryptedBackup(srcStore, backupFile, PWD)
    expect(importEncryptedBackup(dstStore, backupFile, PWD).imported).toBe(3)
    // 修改目标库中一条，再次导入应跳过而不覆盖
    const first = dstStore.list()[0]
    dstStore.update(first.id, draft({ title: '本地修改' }))
    const stats = importEncryptedBackup(dstStore, backupFile, PWD)
    expect(stats).toEqual({ total: 3, imported: 0, skipped: 3 })
    expect(dstStore.list()[0].title).toBe('本地修改')
  })

  it('不同 id 的新条目正常合并', () => {
    dstStore.add(draft({ title: '本地条目' }))
    exportEncryptedBackup(srcStore, backupFile, PWD)
    const stats = importEncryptedBackup(dstStore, backupFile, PWD)
    expect(stats).toEqual({ total: 3, imported: 3, skipped: 0 })
    expect(dstStore.list()).toHaveLength(4)
    expect(dstStore.list().some((e) => e.title === '本地条目')).toBe(true)
  })

  it('导入前自动创建当前数据的完整备份', () => {
    dstStore.add(draft({ title: '导入前本地条目' }))
    exportEncryptedBackup(srcStore, backupFile, PWD)
    importEncryptedBackup(dstStore, backupFile, PWD)

    const baks = fs.readdirSync(dstDir).filter((f) => f.includes('.bak-'))
    expect(baks).toHaveLength(1)
    // 备份内容 = 导入前状态（仅本地条目，不含导入条目）
    const meta = JSON.parse(fs.readFileSync(path.join(dstDir, baks[0]), 'utf-8'))
    const plain = meta.encrypted ? safeStorage.decryptString(Buffer.from(meta.payload, 'base64')) : meta.payload
    expect(plain).toContain('导入前本地条目')
    expect(plain).not.toContain('GitHub')
    // 备份后当前库包含合并结果
    expect(dstStore.list()).toHaveLength(4)
  })

  it('导入条目经过规范化净化（trim / 分类归入）', () => {
    srcStore.add(draft({ title: '  脏数据  ', category: 'not-a-category', url: 'https://x' }))
    exportEncryptedBackup(srcStore, backupFile, PWD)
    importEncryptedBackup(dstStore, backupFile, PWD)
    const cleaned = dstStore.list().find((e) => e.title === '脏数据')
    expect(cleaned?.category).toBe('other')
  })

  it('备份内容包含非法条目时整体失败且回滚', () => {
    dstStore.add(draft({ title: '已有条目' }))
    // 超长标题触发 normalizeDraft 校验失败
    const invalid = [
      { id: 'bad', title: 'x'.repeat(101), category: 'other', url: '', username: '', password: '', notes: '' },
    ] as Parameters<VaultStore['mergeEntries']>[0]
    expect(() => dstStore.mergeEntries(invalid)).toThrow('名称过长')
    // 回滚：无任何变更
    expect(dstStore.list()).toHaveLength(1)
  })
})
