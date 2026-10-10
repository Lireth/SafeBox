import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '../shared/types'

/**
 * 应用设置持久化（userData/settings.json）
 * - 非敏感数据，明文 JSON 存储（与 lock.pin / vault.safebox 同目录）
 * - 读取容错：文件缺失 / 损坏 / 字段非法一律回落默认值，绝不阻塞启动
 * - 写入原子：tmp + rename，防止崩溃留下半截 JSON
 */

/** 设置默认值（新增开关时在此登记） */
export const DEFAULT_SETTINGS: AppSettings = {
  minimizeToTray: false,
  language: 'auto',
  openAtLogin: false,
}

export class SettingsStore {
  private readonly file: string
  private current: AppSettings = { ...DEFAULT_SETTINGS }

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'settings.json')
  }

  /** 当前内存中的设置（主进程内部直接读取，无需每次解析磁盘） */
  get settings(): AppSettings {
    return this.current
  }

  /** 启动时加载：逐字段校验，非法字段回落默认值（与 vault.normalizeEntry 容错思路一致） */
  load(): AppSettings {
    this.current = { ...DEFAULT_SETTINGS }
    try {
      if (!fs.existsSync(this.file)) return this.current
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as unknown
      if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>
        if (typeof obj.minimizeToTray === 'boolean') {
          this.current.minimizeToTray = obj.minimizeToTray
        }
        if (obj.language === 'auto' || obj.language === 'zh' || obj.language === 'en') {
          this.current.language = obj.language
        }
        if (typeof obj.openAtLogin === 'boolean') {
          this.current.openAtLogin = obj.openAtLogin
        }
      }
    } catch {
      // 损坏的设置文件：静默回落默认值，不弹窗不打日志（非关键数据）
    }
    return this.current
  }

  /** 局部更新并落盘，返回完整设置 */
  update(patch: Partial<AppSettings>): AppSettings {
    const next: AppSettings = { ...this.current }
    if (typeof patch.minimizeToTray === 'boolean') next.minimizeToTray = patch.minimizeToTray
    if (patch.language === 'auto' || patch.language === 'zh' || patch.language === 'en') next.language = patch.language
    if (typeof patch.openAtLogin === 'boolean') next.openAtLogin = patch.openAtLogin
    this.current = next
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8')
    fs.renameSync(tmp, this.file)
    return next
  }
}
