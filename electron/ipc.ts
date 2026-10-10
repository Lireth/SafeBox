import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import { exportEncryptedBackup, importEncryptedBackup } from './backup'
import { buildCsv, mapCsvEntries, parseCsvRows } from './csv'
import { SafeBoxError, toIpcError } from './errors'
import { exportDiagnostics } from './logger'
import type { AppSettings, EntryDraft } from '../shared/types'
import { LockManager } from './lock'
import type { SettingsStore } from './settings'
import { checkForUpdate, installUpdate } from './updater'
import { VaultStore } from './vault'
import { normalizeHttpUrl } from './url'

/** 剪贴板自动清空时长（毫秒） */
const CLIPBOARD_CLEAR_MS = 30 * 1000

/** 最近一次由本应用复制的内容（O30：锁定/退出时精确回收，不误伤用户其他复制内容） */
let lastCopied = ''

/**
 * 若剪贴板当前内容仍是本应用最近复制的值，则立即清空并解除跟踪（O30）。
 * 锁定与退出时调用：退出后 30 秒自动清空定时器随进程消亡，不清则会无限期残留。
 */
export function clearTrackedClipboard(): void {
  if (lastCopied && clipboard.readText() === lastCopied) {
    clipboard.writeText('')
  }
  lastCopied = ''
}

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
  /** 锁定守卫：锁定态下抛错，防止敏感数据 / 敏感操作离开主进程 */
  const guard = <T>(handler: () => T): T => {
    if (lock.isLocked) throw new SafeBoxError('LOCKED', '应用已锁定，请先解锁')
    return handler()
  }

  /**
   * IPC 注册包装（O31）：SafeBoxError 在此序列化为 JSON 信封（渲染端按 code 渲染本地化文案），
   * 其余错误（意外 bug）原样透传。所有 handler 统一经此注册。
   */
  const handleIpc = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      try {
        return await fn(event, ...args)
      } catch (err) {
        throw toIpcError(err)
      }
    })
  }

  // ---- 应用状态 ----

  handleIpc('app:load-status', () => store.getLoadStatus())

  handleIpc('app:open-data-dir', async () => {
    // 返回空字符串表示成功，否则为平台错误信息
    const error = await shell.openPath(app.getPath('userData'))
    if (error) throw new SafeBoxError('DATA_DIR_FAIL', `无法打开数据目录: ${error}`, { detail: error })
  })

  // ---- 应用设置（非敏感偏好，锁定态也可读写） ----

  handleIpc('settings:get', () => settings.settings)

  handleIpc('settings:update', (_event, patch: unknown) => {
    const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<AppSettings>
    const next = settings.update(p)
    // 开机自启即时生效（issue #34）：仅当本次更新涉及该字段
    if (p.openAtLogin !== undefined) applyLoginItem(next.openAtLogin)
    return next
  })

  // 系统区域设置（如 zh-CN / en-US），供渲染端「跟随系统」语言检测（issue #33）
  handleIpc('app:get-locale', () => app.getLocale())

  // ---- 诊断日志导出（issue #35，非敏感数据：logger 已脱敏，锁定态也可导出） ----

  handleIpc('logs:export', async () => {
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

  handleIpc('lock:get-state', () => ({ pinEnabled: lock.pinEnabled, locked: lock.isLocked }))

  // O28：锁定态下 setup / clear 同样被 guard 拒绝——二者的 oldPin 校验不走解锁退避，
  // 若放行将构成绕过 MAX_UNLOCK_ATTEMPTS 的爆破旁路（成功一次即可自行改 PIN 解锁）。
  // 正常 UI 在锁定态也不会触达这两个入口；lock / unlock / get-state 是解锁路径，必须放行。
  handleIpc('lock:setup', (_event, oldPin: unknown, newPin: unknown) =>
    guard(() => lock.setupPin(oldPin, newPin)),
  )

  handleIpc('lock:clear', (_event, oldPin: unknown) => guard(() => lock.clearPin(oldPin, store)))

  handleIpc('lock:lock', () => {
    lock.lock(store)
  })

  handleIpc('lock:unlock', (_event, pin: unknown) => {
    // 结构化结果（O18）：失败不抛错，渲染端按错误码渲染本地化文案
    return lock.unlock(pin, store)
  })

  // ---- 加密备份导出 / 导入（锁定期间拒绝） ----

  /** 当前主窗口（用于挂载系统对话框），无窗口时为 null */
  const mainWindow = () => BrowserWindow.getAllWindows()[0] ?? null

  const BACKUP_FILE_FILTER = [{ name: 'SafeBox 加密备份', extensions: ['json'] }]

  handleIpc('backup:export', (_event, password: unknown) =>
    guard(async () => {
      const win = mainWindow()
      const result = await dialog.showSaveDialog(win, {
        title: '导出加密备份',
        defaultPath: `safebox-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: BACKUP_FILE_FILTER,
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      const count = exportEncryptedBackup(store, result.filePath, assertString(password, 'passphrase'))
      return { canceled: false, path: result.filePath, count }
    }),
  )

  handleIpc('backup:import', (_event, password: unknown) =>
    guard(async () => {
      const win = mainWindow()
      const result = await dialog.showOpenDialog(win, {
        title: '导入加密备份',
        filters: BACKUP_FILE_FILTER,
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return { canceled: true }
      const stats = importEncryptedBackup(store, result.filePaths[0], assertString(password, 'passphrase'))
      return { canceled: false, ...stats }
    })
  )

  // ---- CSV 导入（第三方密码管理器迁移；锁定期间拒绝） ----

  handleIpc('backup:import-csv', () =>
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

  handleIpc('backup:export-csv', (_event, pin: unknown) =>
    guard(async () => {
      // 二次身份确认：已启用锁定时必须携带正确 PIN（渲染端强确认弹窗后传入）
      if (lock.pinEnabled) {
        if (typeof pin !== 'string' || !pin) throw new SafeBoxError('PIN_REQUIRED', '请输入锁定 PIN 以确认导出')
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

  handleIpc('update:install', () => {
    installUpdate()
  })

  // 手动检查更新（F25）：同步返回检查结论（发现新版本时后台继续下载，就绪后经既有横幅通知）
  handleIpc('update:check', () => checkForUpdate())

  // ---- 账号 CRUD（锁定期间拒绝访问数据） ----

  handleIpc('entries:list', () => guard(() => store.list()))

  handleIpc('entries:add', (_event, draft: unknown) => guard(() => store.add(draft as EntryDraft)))

  handleIpc('entries:update', (_event, id: unknown, draft: unknown) =>
    guard(() => store.update(assertString(id, 'id'), draft as EntryDraft)),
  )

  handleIpc('entries:delete', (_event, id: unknown) => {
    guard(() => store.remove(assertString(id, 'id')))
  })

  handleIpc('entries:restore', (_event, id: unknown) => guard(() => store.restore(assertString(id, 'id'))))

  // 恢复回收站全部账号（F19）：返回恢复数量
  handleIpc('entries:restore-all', () => guard(() => store.restoreAll()))

  handleIpc('entries:purge', (_event, id: unknown) => {
    guard(() => store.purge(assertString(id, 'id')))
  })

  // 清空回收站（F19）：物理删除全部回收站条目，返回删除数量
  handleIpc('entries:purge-all', () => guard(() => store.purgeAll()))

  handleIpc('entries:toggle-favorite', (_event, id: unknown) =>
    guard(() => store.toggleFavorite(assertString(id, 'id'))),
  )

  // ---- 剪贴板与外链 ----

  let clipboardTimer: NodeJS.Timeout | null = null

  handleIpc('clipboard:copy', (_event, text: unknown) => {
    const value = assertString(text, 'content')
    if (lock.isLocked) throw new SafeBoxError('LOCKED', '应用已锁定，请先解锁')
    if (!value) return
    clipboard.writeText(value)
    // O30 说明：曾尝试追加 Windows「ExcludeClipboardContentFromMonitorProcessing」自定义格式
    // 以排除剪贴板历史（Win+V）/跨设备云同步，但 Electron 的 clipboard 每次 write 都整板替换
    // （实测 Electron 37 / Windows：writeText 与 writeBuffer 无法共存，后写者独占，文本被清空），
    // 纯 JS 无法同时携带两种格式，需原生插件实现——超出零原生依赖约束。
    // 故以「30 秒自动清空 + 锁定/退出即清（clearTrackedClipboard）」兜底敏感残留。
    lastCopied = value
    // 到期后若剪贴板内容未被覆盖，则自动清空，降低敏感信息残留风险
    if (clipboardTimer) clearTimeout(clipboardTimer)
    clipboardTimer = setTimeout(() => {
      clipboardTimer = null
      if (clipboard.readText() === value) clipboard.writeText('')
    }, CLIPBOARD_CLEAR_MS)
  })

  // 锁定时同步收口剪贴板（O30）：手动/空闲/锁屏/托盘各锁定路径统一经 lock() 触发
  lock.onLock(clearTrackedClipboard)

  // O27：与窗口 openHandler 共用同一 http/https 白名单（normalizeHttpUrl）
  handleIpc('app:open-external', (_event, url: unknown) => {
    const normalized = normalizeHttpUrl(url)
    if (!normalized) return
    void shell.openExternal(normalized)
  })

  // ---- 渲染端异常采集（O32） ----
  // 渲染端入口监听 error/unhandledrejection 后经此上报（fire-and-forget），
  // 经 console.error 进入诊断日志的缓冲与落盘，由 logger 统一脱敏。
  // 注意：监听必须位于渲染端主世界——脚本引擎级事件（error/unhandledrejection）
  // 按隔离世界派发，沙箱 preload（隔离世界）收不到主世界的未捕获异常（冒烟实证）。
  handleIpc('logs:renderer-error', (_event, message: unknown, stack: unknown) => {
    const msg = typeof message === 'string' && message ? message : '未知渲染端异常'
    const detail = typeof stack === 'string' && stack ? `\n${stack}` : ''
    console.error(`[renderer] ${msg}${detail}`)
  })
}

/** IPC 入参字段（field 传稳定键名，渲染端按 key 查本地化字段名，O31） */
const IPC_FIELD_LABELS = { content: '内容', url: '网址', id: 'ID', passphrase: '口令' } as const

function assertString(value: unknown, field: keyof typeof IPC_FIELD_LABELS): string {
  if (typeof value !== 'string') {
    throw new SafeBoxError('FIELD_FORMAT', `${IPC_FIELD_LABELS[field]}格式错误`, { field })
  }
  return value
}
