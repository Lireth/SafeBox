import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LockScreen } from '../../src/renderer/src/components/LockScreen'
import { setLang } from '../../src/renderer/src/lib/i18n'
import type { UnlockResult } from '../../shared/types'

function setup() {
  const onSubmit = vi.fn<(pin: string) => Promise<UnlockResult>>()
  const { container } = render(<LockScreen onSubmit={onSubmit} />)
  const form = container.querySelector('form') as HTMLFormElement
  return { onSubmit, form }
}

const pinInput = (): HTMLInputElement => screen.getByPlaceholderText<HTMLInputElement>('锁定 PIN')

afterEach(() => {
  vi.useRealTimers()
  setLang('zh')
})

describe('LockScreen 解锁交互', () => {
  it('初始展示锁屏文案，未输入 PIN 时解锁按钮禁用', () => {
    setup()
    expect(screen.getByText('秘匣已锁定')).toBeInTheDocument()
    expect(screen.getByText('输入锁定 PIN 以继续访问您的账号')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '解锁' })).toBeDisabled()
  })

  it('输入 PIN 提交后调用 onSubmit', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup()
    onSubmit.mockResolvedValue({ ok: true })
    await user.type(pinInput(), '123456')
    expect(screen.getByRole('button', { name: '解锁' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '解锁' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('123456'))
  })

  it('PIN 错误显示错误信息并清空输入', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup()
    onSubmit.mockResolvedValue({ ok: false, code: 'PIN_WRONG' })
    await user.type(pinInput(), '000000')
    await user.click(screen.getByRole('button', { name: '解锁' }))
    expect(await screen.findByText('PIN 不正确')).toBeInTheDocument()
    expect(pinInput()).toHaveValue('')
  })

  it('提交期间按钮显示「验证中…」并禁用', async () => {
    let release!: (value: UnlockResult) => void
    const { onSubmit, form } = setup()
    onSubmit.mockImplementation(() => new Promise<UnlockResult>((r) => (release = r)))
    fireEvent.change(pinInput(), { target: { value: '123456' } })
    fireEvent.submit(form)
    expect(await screen.findByRole('button', { name: '验证中…' })).toBeDisabled()
    release({ ok: true })
  })

  it('连续失败 2 次后，第 3 次提交期间显示失败次数提示', async () => {
    let release!: (value: UnlockResult) => void
    const { onSubmit, form } = setup()
    onSubmit
      .mockResolvedValueOnce({ ok: false, code: 'PIN_WRONG' })
      .mockResolvedValueOnce({ ok: false, code: 'PIN_WRONG' })
      .mockImplementationOnce(() => new Promise<UnlockResult>((r) => (release = r)))
    for (let i = 0; i < 2; i++) {
      fireEvent.change(pinInput(), { target: { value: '000000' } })
      fireEvent.submit(form)
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(i + 1))
      expect(await screen.findByText('PIN 不正确')).toBeInTheDocument()
    }
    // 第 3 次提交：错误已清空但请求进行中 → 展示累计失败次数（failCount 此时为 2）
    fireEvent.change(pinInput(), { target: { value: '000000' } })
    fireEvent.submit(form)
    expect(await screen.findByText('已连续失败 2 次')).toBeInTheDocument()
    release({ ok: true })
  })

  it('结构化退避结果启动本地倒计时，冷却期内禁止提交', async () => {
    const { onSubmit, form } = setup()
    onSubmit.mockResolvedValue({ ok: false, code: 'COOLDOWN', retryAfterMs: 30_000 })
    fireEvent.change(pinInput(), { target: { value: '000000' } })
    fireEvent.submit(form)
    const btn = await screen.findByRole('button', { name: '请 30 秒后重试' })
    expect(btn).toBeDisabled()
    expect(screen.getByText('失败次数过多，请稍后再试')).toBeInTheDocument()
    const attempts = onSubmit.mock.calls.length
    fireEvent.submit(form)
    expect(onSubmit).toHaveBeenCalledTimes(attempts)
  })

  it('英文界面下退避倒计时按本地语言渲染（O18 验收：不再解析主进程中文消息）', async () => {
    setLang('en')
    const { onSubmit, form } = setup()
    onSubmit.mockResolvedValue({ ok: false, code: 'COOLDOWN', retryAfterMs: 30_000 })
    fireEvent.change(screen.getByPlaceholderText('Lock PIN'), { target: { value: '000000' } })
    fireEvent.submit(form)
    const btn = await screen.findByRole('button', { name: 'Retry in 30s' })
    expect(btn).toBeDisabled()
    expect(screen.getByText('Too many failed attempts. Please wait and try again')).toBeInTheDocument()
  })

  it('倒计时每秒递减，归零后恢复解锁按钮', async () => {
    // 仅 fake interval：Promise 微任务（onSubmit 结果）不依赖定时器，
    // 因此进入冷却后用同步 getByRole 断言，避免 findBy 的轮询 setInterval 被冻结
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { onSubmit, form } = setup()
    onSubmit.mockResolvedValue({ ok: false, code: 'COOLDOWN', retryAfterMs: 3_000 })
    fireEvent.change(pinInput(), { target: { value: '000000' } })
    fireEvent.submit(form)
    // 冲刷 onSubmit 返回的微任务，进入冷却倒计时
    await act(async () => {})
    expect(screen.getByRole('button', { name: '请 3 秒后重试' })).toBeDisabled()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByRole('button', { name: '请 2 秒后重试' })).toBeDisabled()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    // 倒计时归零：按钮恢复「解锁」标签（PIN 输入框已被清空，故仍禁用，需重新输入）
    expect(screen.getByRole('button', { name: '解锁' })).toBeInTheDocument()
  })

  it('IPC 通道异常时显示兜底错误文案', async () => {
    const { onSubmit, form } = setup()
    onSubmit.mockRejectedValue(new Error('通道异常'))
    fireEvent.change(pinInput(), { target: { value: '000000' } })
    fireEvent.submit(form)
    expect(await screen.findByText('解锁失败，请重试')).toBeInTheDocument()
  })
})
