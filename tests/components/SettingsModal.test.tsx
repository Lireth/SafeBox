import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from '../../src/renderer/src/components/SettingsModal'
import { getLang, setLang } from '../../src/renderer/src/lib/i18n'
import type { AppSettings } from '../../shared/types'

/**
 * 语言切换组件测试（issue #33）：SettingsModal 选择语言 → 调用 updateSettings + getLocale，
 * i18n 立即切换并触发弹窗重渲染。弹窗显示语言取全局 current，选择器值取已保存设置。
 */
function mockSafebox(settings: AppSettings, locale = 'zh-CN') {
  const updateSettings = vi.fn<(patch: Partial<AppSettings>) => Promise<AppSettings>>()
  const getLocale = vi.fn<() => Promise<string>>()
  updateSettings.mockImplementation((patch) => Promise.resolve({ ...settings, ...patch }))
  getLocale.mockResolvedValue(locale)
  const api: Record<string, unknown> = {
    getSettings: vi.fn<() => Promise<AppSettings>>().mockResolvedValue(settings),
    updateSettings,
    getLocale,
    onLockChanged: vi.fn(() => () => {}),
    onUpdateReady: vi.fn(() => () => {}),
  }
  // SettingsModal 未用到的 API 给空实现兜底
  for (const m of ['listEntries', 'getLoadStatus', 'getLockState', 'setupLockPin', 'clearLockPin', 'lockNow', 'unlockApp', 'exportEncryptedBackup', 'importEncryptedBackup', 'importCsv', 'exportCsv', 'installUpdate', 'addEntry', 'updateEntry', 'deleteEntry', 'restoreEntry', 'purgeEntry', 'toggleFavorite', 'copyText', 'openExternal', 'openDataDir']) {
    api[m] = vi.fn()
  }
  vi.stubGlobal('safebox', api)
  return { updateSettings, getLocale }
}

beforeEach(() => {
  setLang('zh')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setLang('zh')
})

/** 默认设置夹具（AppSettings 必填字段齐全） */
const baseSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
  minimizeToTray: false,
  language: 'zh',
  openAtLogin: false,
  ...overrides,
})

describe('SettingsModal 语言切换', () => {
  it('选择 English：updateSettings 收到 en，弹窗重渲染为英文', async () => {
    const user = userEvent.setup()
    const { updateSettings } = mockSafebox(baseSettings())
    render(<SettingsModal onClose={() => {}} />)

    expect(await screen.findByText('设置')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('界面语言'), 'en')

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ language: 'en' }))
    expect(await screen.findByText('Settings')).toBeInTheDocument()
    expect(getLang()).toBe('en')
  })

  it('选择跟随系统（auto）：按系统 locale 解析有效语言', async () => {
    const user = userEvent.setup()
    // 系统 locale 为 en-US：从中文界面选 auto 应解析为英文
    mockSafebox(baseSettings(), 'en-US')
    render(<SettingsModal onClose={() => {}} />)
    await screen.findByText('设置')
    await user.selectOptions(screen.getByLabelText('界面语言'), 'auto')
    await waitFor(() => expect(getLang()).toBe('en'))
  })
})

describe('SettingsModal 开机自启开关（issue #34）', () => {
  it('勾选开机自启：updateSettings 收到 openAtLogin:true，复选框变为选中', async () => {
    const user = userEvent.setup()
    const { updateSettings } = mockSafebox(baseSettings({ openAtLogin: false }))
    render(<SettingsModal onClose={() => {}} />)

    const checkbox = await screen.findByRole<HTMLInputElement>('checkbox', { name: '开机自动启动秘匣' })
    expect(checkbox.checked).toBe(false)
    await user.click(checkbox)
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ openAtLogin: true }))
    // 持久化回读后 UI 反映新状态
    await waitFor(() => expect(checkbox.checked).toBe(true))
  })

  it('取消勾选：updateSettings 收到 openAtLogin:false', async () => {
    const user = userEvent.setup()
    const { updateSettings } = mockSafebox(baseSettings({ openAtLogin: true }))
    render(<SettingsModal onClose={() => {}} />)

    const checkbox = await screen.findByRole<HTMLInputElement>('checkbox', { name: '开机自动启动秘匣' })
    expect(checkbox.checked).toBe(true)
    await user.click(checkbox)
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ openAtLogin: false }))
  })

  it('开启托盘但未开自启时显示联动提示，两者都开时隐藏', async () => {
    const user = userEvent.setup()
    mockSafebox(baseSettings({ minimizeToTray: true, openAtLogin: false }))
    render(<SettingsModal onClose={() => {}} />)
    // 初始：托盘开、自启关 → 显示联动提示
    expect(await screen.findByText(/配合开机自启可获得常驻后台/)).toBeInTheDocument()
    // 勾选自启后 → 联动提示消失
    await user.click(screen.getByRole('checkbox', { name: '开机自动启动秘匣' }))
    await waitFor(() => expect(screen.queryByText(/配合开机自启可获得常驻后台/)).toBeNull())
  })
})
