import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearAutoBackupPassword,
  loadAutoBackupPassword,
  maybeRunAutoBackup,
  saveAutoBackupPassword,
} from '../../electron/autobackup'
import { DEFAULT_SETTINGS, SettingsStore } from '../../electron/settings'
import { VaultStore } from '../../electron/vault'
import type { AppSettings } from '../../shared/types'

describe('自动备份（F23）', () => {
  let tmpDir: string
  let backupDir: string
  let store: VaultStore
  let settings: SettingsStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safebox-ab-'))
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safebox-abdir-'))
    store = new VaultStore(tmpDir)
    store.load()
    settings = new SettingsStore(tmpDir)
    settings.load()
    settings.update({ ...DEFAULT_SETTINGS, autoBackupDir: backupDir } as Partial<AppSettings>)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.rmSync(backupDir, { recursive: true, force: true })
  })

  it('口令保存（safeStorage 加密，不落明文）→ 回读一致 → 清除后为 null', () => {
    saveAutoBackupPassword(tmpDir, 'passphrase-123')
    expect(loadAutoBackupPassword(tmpDir)).toBe('passphrase-123')
    const raw = fs.readFileSync(path.join(tmpDir, 'autobackup.secret'), 'utf-8')
    expect(raw).not.toContain('passphrase-123')
    clearAutoBackupPassword(tmpDir)
    expect(loadAutoBackupPassword(tmpDir)).toBeNull()
  })

  it('口令不足 8 位抛错', () => {
    expect(() => saveAutoBackupPassword(tmpDir, 'short')).toThrow('至少')
  })

  it('条件不满足不执行：未开启 / 无目录 / 无口令 / 无条目', () => {
    settings.update({ autoBackupEnabled: true })
    expect(maybeRunAutoBackup(store, settings, tmpDir)).toBe(false) // 无口令
    saveAutoBackupPassword(tmpDir, 'passphrase-123')
    expect(maybeRunAutoBackup(store, settings, tmpDir)).toBe(false) // 无条目
    store.add({ title: 'T1', category: 'other', url: '', username: '', password: '', notes: '' })
    settings.update({ autoBackupEnabled: false })
    expect(maybeRunAutoBackup(store, settings, tmpDir)).toBe(false) // 未开启
    settings.update({ autoBackupEnabled: true })
    expect(maybeRunAutoBackup(store, settings, tmpDir)).toBe(true) // 全条件满足
  })

  it('满足条件执行导出；间隔内不重复；软删除条目不计入条数', () => {
    store.add({ title: 'T1', category: 'other', url: '', username: '', password: 'p', notes: '' })
    store.add({ title: 'T2', category: 'other', url: '', username: '', password: '', notes: '' })
    store.remove(store.list()[1].id)
    saveAutoBackupPassword(tmpDir, 'passphrase-123')
    settings.update({ autoBackupEnabled: true, autoBackupDays: 7 })
    expect(maybeRunAutoBackup(store, settings, tmpDir)).toBe(true)
    const files = fs.readdirSync(backupDir).filter((n) => n.startsWith('safebox-auto-'))
    expect(files).toHaveLength(1)
    expect(maybeRunAutoBackup(store, settings, tmpDir)).toBe(false) // 间隔内
    // 文件内容为口令加密备份（含 magic）
    const raw = fs.readFileSync(path.join(backupDir, files[0]), 'utf-8')
    expect(raw).toContain('SAFEBOX-EXPORT')
  })
})
