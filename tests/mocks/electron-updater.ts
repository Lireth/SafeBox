/**
 * electron-updater 模块替身（经 vitest.config.ts 的 resolve.alias 指向本文件）。
 * 提供最小事件源接口，测试通过 mockState 驱动行为。
 */

type Listener = (info: { version: string }) => void

export const mockState = {
  /** checkForUpdates 被调用次数 */
  checkCount: 0,
  /** checkForUpdates 是否应抛错（模拟网络失败） */
  checkShouldFail: false,
  /** quitAndInstall 是否被调用 */
  installed: false,
  /** BrowserWindow.getAllWindows() 返回的窗口列表 */
  windows: [] as Array<{ isDestroyed: () => boolean; webContents: { send: (channel: string, payload: unknown) => void } }>
}

const listeners = new Map<string, Listener[]>()

export const autoUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  logger: null as unknown,
  on(event: string, listener: Listener): void {
    console.log('[mock-updater] on registered:', event)
    const list = listeners.get(event) ?? []
    list.push(listener)
    listeners.set(event, list)
  },
  checkForUpdates(): Promise<unknown> {
    mockState.checkCount++
    if (mockState.checkShouldFail) return Promise.reject(new Error('ENOTFOUND: no network'))
    return Promise.resolve({})
  },
  quitAndInstall(): void {
    mockState.installed = true
  },
  /** 测试辅助：触发事件 */
  __emit(event: string, info: { version: string }): void {
    listeners.get(event)?.forEach((listener) => listener(info))
  },
  /** 测试辅助：事件监听数量 */
  __listenerCount: (event: string): number => listeners.get(event)?.length ?? 0
}

export const BrowserWindow = {
  getAllWindows: () => mockState.windows
}