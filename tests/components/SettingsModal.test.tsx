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

describe('SettingsModal 语言切换', () => {
  it('选择 English：updateSettings 收到 en，弹窗重渲染为英文', async () => {
    const user = userEvent.setup()
    const { updateSettings } = mockSafebox({ minimizeToTray: false, language: 'zh' })
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
    mockSafebox({ minimizeToTray: false, language: 'zh' }, 'en-US')
    render(<SettingsModal onClose={() => {}} />)
    await screen.findByText('设置')
    await user.selectOptions(screen.getByLabelText('界面语言'), 'auto')
    await waitFor(() => expect(getLang()).toBe('en'))
  })
})
