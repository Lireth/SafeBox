import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LockScreen } from '../../src/renderer/src/components/LockScreen'

function setup() {
  const onSubmit = vi.fn<(pin: string) => Promise<void>>()
  const { container } = render(<LockScreen onSubmit={onSubmit} />)
  const form = container.querySelector('form') as HTMLFormElement
  return { onSubmit, form }
}

const pinInput = (): HTMLInputElement => screen.getByPlaceholderText<HTMLInputElement>('锁定 PIN')

afterEach(() => {
  vi.useRealTimers()
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
    onSubmit.mockResolvedValue()
    await user.type(pinInput(), '123456')
    expect(screen.getByRole('button', { name: '解锁' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '解锁' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('123456'))
  })

  it('PIN 错误显示错误信息并清空输入', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup()
    onSubmit.mockRejectedValue(new Error('PIN 不正确'))
    await user.type(pinInput(), '000000')
    await user.click(screen.getByRole('button', { name: '解锁' }))
    expect(await screen.findByText('PIN 不正确')).toBeInTheDocument()
    expect(pinInput()).toHaveValue('')
  })

  it('提交期间按钮显示「验证中…」并禁用', async () => {
    let release!: () => void
    const { onSubmit, form } = setup()
    onSubmit.mockImplementation(() => new Promise<void>((r) => (release = r)))
    fireEvent.change(pinInput(), { target: { value: '123456' } })
    fireEvent.submit(form)
    expect(await screen.findByRole('button', { name: '验证中…' })).toBeDisabled()
    release()
  })

  it('连续失败 2 次后，第 3 次提交期间显示失败次数提示', async () => {
    let release!: () => void
    const { onSubmit, form } = setup()
    onSubmit
      .mockRejectedValueOnce(new Error('PIN 不正确'))
      .mockRejectedValueOnce(new Error('PIN 不正确'))
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
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
    release()
  })

  it('退避提示解析为本地倒计时，冷却期内禁止提交', async () => {
    const { onSubmit, form } = setup()
    onSubmit.mockRejectedValue(new Error('PIN 不正确，失败次数过多，已锁定 30 秒'))
    fireEvent.change(pinInput(), { target: { value: '000000' } })
    fireEvent.submit(form)
    const btn = await screen.findByRole('button', { name: '请 30 秒后重试' })
    expect(btn).toBeDisabled()
    const attempts = onSubmit.mock.calls.length
    fireEvent.submit(form)
    expect(onSubmit).toHaveBeenCalledTimes(attempts)
  })

  it('倒计时每秒递减，归零后恢复解锁按钮', async () => {
    // 仅 fake interval：Promise 微任务（onSubmit 拒绝）不依赖定时器，
    // 因此进入冷却后用同步 getByRole 断言，避免 findBy 的轮询 setInterval 被冻结
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { onSubmit, form } = setup()
    onSubmit.mockRejectedValue(new Error('PIN 不正确，失败次数过多，已锁定 3 秒'))
    fireEvent.change(pinInput(), { target: { value: '000000' } })
    fireEvent.submit(form)
    // 冲刷 onSubmit 拒绝的微任务，进入冷却倒计时
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
})
