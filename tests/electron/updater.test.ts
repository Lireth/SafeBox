import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initAutoUpdater, checkNow, installUpdate } from '../../electron/updater'

/**
 * 自动更新接线测试。
 * 使用 vi.mock（hoisted 工厂）替换 electron / electron-updater，保证与被测模块同实例。
 */

const mocks = vi.hoisted(() => {
  const state = {
    isPackaged: false,
    checkCount: 0,
    checkShouldFail: false,
    installed: false,
    windows: [] as Array<{
      isDestroyed: () => boolean
      webContents: { send: (channel: string, payload: unknown) => void }
    }>
  }
  const listeners = new Map<string, Array<(info: { version: string }) => void>>()
  return {
    state,
    app: {
      get isPackaged() {
        return state.isPackaged
      },
      set isPackaged(value: boolean) {
        state.isPackaged = value
      }
    },
    BrowserWindow: {
      getAllWindows: () => state.windows
    },
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on(event: string, listener: (info: { version: string }) => void) {
        const list = listeners.get(event) ?? []
        list.push(listener)
        listeners.set(event, list)
      },
      checkForUpdates(): Promise<unknown> {
        state.checkCount++
        if (state.checkShouldFail) return Promise.reject(new Error('ENOTFOUND: no network'))
        return Promise.resolve({})
      },
      quitAndInstall() {
        state.installed = true
      },
      __emit(event: string, info: { version: string }) {
        listeners.get(event)?.forEach((listener) => listener(info))
      },
      __listenerCount(event: string) {
        return listeners.get(event)?.length ?? 0
      }
    }
  }
})

vi.mock('electron', () => ({ app: mocks.app, BrowserWindow: mocks.BrowserWindow }))
vi.mock('electron-updater', () => ({ autoUpdater: mocks.autoUpdater }))

describe('自动更新接线', () => {
  const { state, autoUpdater } = mocks
  let checkCountAfterDevInit: number
  let checkCountAfterPackagedInit: number

  beforeAll(() => {
    // fake 定时器防止轮询 interval 在测试期间真实触发
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    // 1) 开发环境（未打包）：应完全跳过
    state.isPackaged = false
    initAutoUpdater()
    checkCountAfterDevInit = state.checkCount

    // 2) 打包环境：启用静默下载并立即检查
    state.isPackaged = true
    initAutoUpdater()
    checkCountAfterPackagedInit = state.checkCount
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    state.checkCount = 0
    state.checkShouldFail = false
    state.installed = false
    state.windows = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('开发环境（未打包）跳过更新检查', () => {
    expect(checkCountAfterDevInit).toBe(0)
  })

  it('打包环境启用静默下载 + 退出安装，并立即检查一次', () => {
    expect(autoUpdater.autoDownload).toBe(true)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
    expect(autoUpdater.__listenerCount('update-downloaded')).toBe(1)
    // 快照对比：打包 init 恰好比 dev init 多检查一次
    expect(checkCountAfterPackagedInit).toBe(checkCountAfterDevInit + 1)
  })

  it('检查失败静默降级（不向上抛错）', async () => {
    state.checkShouldFail = true
    await expect(checkNow()).resolves.toBeUndefined()
    expect(state.checkCount).toBe(1)
  })

  it('更新下载完成后向渲染端广播版本信息', () => {
    const sent: Array<{ channel: string; payload: unknown }> = []
    state.windows = [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) }
      }
    ]
    autoUpdater.__emit('update-downloaded', { version: '9.9.9' })
    expect(sent).toEqual([{ channel: 'update:available', payload: { version: '9.9.9' } }])
  })

  it('无窗口时广播安全跳过', () => {
    state.windows = []
    expect(() => autoUpdater.__emit('update-downloaded', { version: '9.9.9' })).not.toThrow()
  })

  it('installUpdate 触发退出安装', () => {
    installUpdate()
    expect(state.installed).toBe(true)
  })
})
