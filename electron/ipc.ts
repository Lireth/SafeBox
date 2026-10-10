import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import { exportEncryptedBackup, importEncryptedBackup } from './backup'
import { buildCsv, mapCsvEntries, parseCsvRows } from './csv'
import { exportDiagnostics } from './logger'
import type { AppSettings, EntryDraft } from '../shared/types'
import { LockManager } from './lock'
import type { SettingsStore } from './settings'
import { installUpdate } from './updater'
import { VaultStore } from './vault'

/** 剪贴板自动清空时长（毫秒） */
const CLIPBOARD_CLEAR_MS = 30 * 1000

/**
 * 应用开机自启设置到系统登录项（issue #34，Windows 注册表 Run 键）。
 * 开发模式跳过（避免把 electron.exe 注册为启动项）；失败静默降级不阻塞设置保存。
 */
export function applyLoginItem(openAtLogin: boolean): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin })
    console.info(`[settings] 开机自启已${openAtLogin ? '开启' : '关闭'}`)
  } catch (err) {
    console.warn('[settings] 设置登录项失败:', err)
  }
}

export function registerIpcHandlers(store: VaultStore, lock: LockManager, settings: SettingsStore): void {
  // ---- 应用状态 ----

  ipcMain.handle('app:load-status', () => store.getLoadStatus())

  ipcMain.handle('app:open-data-dir', async () => {
    // 返回空字符串表示成功，否则为平台错误信息
    const error = await shell.openPath(app.getPath('userData'))
    if (error) throw new Error(`无法打开数据目录: ${error}`)
  })

  // ---- 应用设置（非敏感偏好，锁定态也可读写） ----

  ipcMain.handle('settings:get', () => settings.settings)

  ipcMain.handle('settings:update', (_event, patch: unknown) => {
    const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<AppSettings>
    const next = settings.update(p)
    // 开机自启即时生效（issue #34）：仅当本次更新涉及该字段
    if (p.openAtLogin !== undefined) applyLoginItem(next.openAtLogin)
    return next
  })

  // 系统区域设置（如 zh-CN / en-US），供渲染端「跟随系统」语言检测（issue #33）
  ipcMain.handle('app:get-locale', () => app.getLocale())

  // ---- 诊断日志导出（issue #35，非敏感数据：logger 已脱敏，锁定态也可导出） ----

  ipcMain.handle('logs:export', async () => {
    const win = BrowserWindow.getAllWindows()[0] ?? null
    const result = await dialog.showSaveDialog(win, {
      title: '导出诊断日志',
      defaultPath: `safebox-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: '文本文件', extensions: ['txt'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    fs.writeFileSync(result.filePath, exportDiagnostics(), 'utf-8')
    return { canceled: false, path: result.filePath }
  })

  // ---- 应用锁定 ----

  ipcMain.handle('lock:get-state', () => ({ pinEnabled: lock.pinEnabled, locked: lock.isLocked }))

  ipcMain.handle('lock:setup', (_event, oldPin: unknown, newPin: unknown) => {
    lock.setupPin(oldPin, newPin)
  })

  ipcMain.handle('lock:clear', (_event, oldPin: unknown) => {
    lock.clearPin(oldPin, store)
  })

  ipcMain.handle('lock:lock', () => {
    lock.lock(store)
  })

  ipcMain.handle('lock:unlock', (_event, pin: unknown) => {
    // 结构化结果（O18）：失败不抛错，渲染端按错误码渲染本地化文案
    return lock.unlock(pin, store)
  })

  // ---- 加密备份导出 / 导入（锁定期间拒绝） ----

  /** 当前主窗口（用于挂载系统对话框），无窗口时为 null */
  const mainWindow = () => BrowserWindow.getAllWindows()[0] ?? null

  const BACKUP_FILE_FILTER = [{ name: 'SafeBox 加密备份', extensions: ['json'] }]

  ipcMain.handle('backup:export', (_event, password: unknown) =>
    guard(async () => {
      const win = mainWindow()
      const result = await dialog.showSaveDialog(win, {
        title: '导出加密备份',
        defaultPath: `safebox-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: BACKUP_FILE_FILTER,
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      const count = exportEncryptedBackup(store, result.filePath, assertString(password, '口令'))
      return { canceled: false, path: result.filePath, count }
    }),
  )

  ipcMain.handle('backup:import', (_event, password: unknown) =>
    guard(async () => {
      const win = mainWindow()
      const result = await dialog.showOpenDialog(win, {
        title: '导入加密备份',
        filters: BACKUP_FILE_FILTER,
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return { canceled: true }
      const stats = importEncryptedBackup(store, result.filePaths[0], assertString(password, '口令'))
      return { canceled: false, ...stats }
    })
  )

  // ---- CSV 导入（第三方密码管理器迁移；锁定期间拒绝） ----

  ipcMain.handle('backup:import-csv', () =>
    guard(async () => {
      const win = mainWindow()
      const result = await dialog.showOpenDialog(win, {
        title: '从密码管理器导入 CSV',
        filters: [{ name: 'CSV 文件', extensions: ['csv', 'txt'] }],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) return { canceled: true }
      // 明文 CSV 仅在内存中短暂存在：不落临时文件、不写日志
      const text = fs.readFileSync(result.filePaths[0], 'utf-8')
      const { drafts, invalid } = mapCsvEntries(parseCsvRows(text))
      const stats = store.mergeDrafts(drafts)
      return { canceled: false, total: drafts.length, invalid, ...stats }
    }),
  )

  // ---- 明文 CSV 导出（数据可携带性；锁定期间拒绝，启用 PIN 时强制身份校验） ----

  ipcMain.handle('backup:export-csv', (_event, pin: unknown) =>
    guard(async () => {
      // 二次身份确认：已启用锁定时必须携带正确 PIN（渲染端强确认弹窗后传入）
      if (lock.pinEnabled) {
        if (typeof pin !== 'string' || !pin) throw new Error('请输入锁定 PIN 以确认导出')
        lock.verifyPin(pin)
      }
      const win = mainWindow()
      const result = await dialog.showSaveDialog(win, {
        title: '导出明文 CSV（谨慎操作）',
        defaultPath: `safebox-export-${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      // 明文落盘仅此一处（用户强确认后）：不写日志、不留临时文件，直接写入目标路径
      // buildCsv 内部已排除软删除条目，计数口径一致
      const csv = buildCsv(store.list())
      fs.writeFileSync(result.filePath, csv, 'utf-8')
      const count = store.list().filter((e) => !e.deletedAt).length
      return { canceled: false, path: result.filePath, count }
    }),
  )

  // ---- 自动更新 ----

  ipcMain.handle('update:install', () => {
    installUpdate()
  })

  // ---- 账号 CRUD（锁定期间拒绝访问数据） ----

  /** 锁定守卫：锁定态下抛错，防止敏感数据离开主进程 */
  const guard = <T>(handler: () => T): T => {
    if (lock.isLocked) throw new Error('应用已锁定，请先解锁')
    return handler()
  }

  ipcMain.handle('entries:list', () => guard(() => store.list()))

  ipcMain.handle('entries:add', (_event, draft: unknown) => guard(() => store.add(draft as EntryDraft)))

  ipcMain.handle('entries:update', (_event, id: unknown, draft: unknown) =>
    guard(() => store.update(assertString(id, 'id'), draft as EntryDraft)),
  )

  ipcMain.handle('entries:delete', (_event, id: unknown) => {
    guard(() => store.remove(assertString(id, 'id')))
  })

  ipcMain.handle('entries:restore', (_event, id: unknown) => guard(() => store.restore(assertString(id, 'id'))))

  // 恢复回收站全部账号（F19）：返回恢复数量
  ipcMain.handle('entries:restore-all', () => guard(() => store.restoreAll()))

  ipcMain.handle('entries:purge', (_event, id: unknown) => {
    guard(() => store.purge(assertString(id, 'id')))
  })

  // 清空回收站（F19）：物理删除全部回收站条目，返回删除数量
  ipcMain.handle('entries:purge-all', () => guard(() => store.purgeAll()))

  ipcMain.handle('entries:toggle-favorite', (_event, id: unknown) =>
    guard(() => store.toggleFavorite(assertString(id, 'id'))),
  )

  // ---- 剪贴板与外链 ----

  let clipboardTimer: NodeJS.Timeout | null = null

  ipcMain.handle('clipboard:copy', (_event, text: unknown) => {
    const value = assertString(text, '内容')
    if (lock.isLocked) throw new Error('应用已锁定，请先解锁')
    if (!value) return
    clipboard.writeText(value)
    // 到期后若剪贴板内容未被覆盖，则自动清空，降低敏感信息残留风险
    if (clipboardTimer) clearTimeout(clipboardTimer)
    clipboardTimer = setTimeout(() => {
      clipboardTimer = null
      if (clipboard.readText() === value) clipboard.writeText('')
    }, CLIPBOARD_CLEAR_MS)
  })

  ipcMain.handle('app:open-external', (_event, url: unknown) => {
    const value = assertString(url, '网址')
    if (!value) return
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw new Error('网址格式错误')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('仅允许打开 http/https 链接')
    }
    void shell.openExternal(parsed.toString())
  })
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field}格式错误`)
  return value
}
