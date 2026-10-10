import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsStore } from '../../electron/settings'

describe('SettingsStore', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safebox-settings-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('无文件时返回默认值', () => {
    const store = new SettingsStore(tmpDir)
    expect(store.load()).toEqual(DEFAULT_SETTINGS)
    expect(store.settings).toEqual({ minimizeToTray: false, language: 'auto' })
  })

  it('update 落盘后重新加载可读取', () => {
    const store = new SettingsStore(tmpDir)
    store.load()
    store.update({ minimizeToTray: true })
    expect(fs.existsSync(path.join(tmpDir, 'settings.json'))).toBe(true)

    const rebooted = new SettingsStore(tmpDir)
    expect(rebooted.load()).toEqual({ minimizeToTray: true, language: 'auto' })
  })

  it('update 仅写入合法字段并返回完整设置', () => {
    const store = new SettingsStore(tmpDir)
    store.load()
    const next = store.update({ minimizeToTray: true, unknownField: 'x' } as never)
    expect(next).toEqual({ minimizeToTray: true, language: 'auto' })
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf-8'))
    expect(raw).toEqual({ minimizeToTray: true, language: 'auto' })
  })

  it('language 合法值持久化并可回读（issue #33）', () => {
    const store = new SettingsStore(tmpDir)
    store.load()
    expect(store.update({ language: 'en' }).language).toBe('en')
    const rebooted = new SettingsStore(tmpDir)
    expect(rebooted.load().language).toBe('en')
  })

  it('language 非法值回落 auto', () => {
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify({ language: 'fr' }), 'utf-8')
    const store = new SettingsStore(tmpDir)
    expect(store.load().language).toBe('auto')
    // update 传非法 language 不覆盖现值
    store.update({ language: 'de' } as never)
    expect(store.settings.language).toBe('auto')
  })

  it('损坏的 JSON 回落默认值且不抛错', () => {
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), '{ not json', 'utf-8')
    const store = new SettingsStore(tmpDir)
    expect(store.load()).toEqual(DEFAULT_SETTINGS)
  })

  it('字段类型非法回落默认值', () => {
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify({ minimizeToTray: 'yes' }), 'utf-8')
    const store = new SettingsStore(tmpDir)
    expect(store.load()).toEqual(DEFAULT_SETTINGS)
  })

  it('写入原子：成功后无残留 tmp 文件', () => {
    const store = new SettingsStore(tmpDir)
    store.load()
    store.update({ minimizeToTray: true })
    expect(fs.existsSync(path.join(tmpDir, 'settings.json.tmp'))).toBe(false)
  })
})
