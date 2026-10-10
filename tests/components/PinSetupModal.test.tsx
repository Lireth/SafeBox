import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PinSetupModal } from '../../src/renderer/src/components/PinSetupModal'

function setup(pinEnabled = false) {
  const onSetup = vi.fn<(oldPin: string | undefined, newPin: string) => Promise<void>>().mockResolvedValue()
  const onClear = vi.fn<(oldPin: string) => Promise<void>>().mockResolvedValue()
  render(<PinSetupModal pinEnabled={pinEnabled} onClose={() => {}} onSetup={onSetup} onClear={onClear} />)
  return { onSetup, onClear }
}

afterEach(() => {
  cleanup()
})

describe('PinSetupModal 即时校验（O22）', () => {
  it('新 PIN 不足最短长度时即时提示，无需提交', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByPlaceholderText('4-32 个字符'), '12')
    expect(await screen.findByText('PIN 长度需为 4-32 个字符')).toBeInTheDocument()
  })

  it('两次输入不一致即时提示', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByPlaceholderText('4-32 个字符'), '123456')
    await user.type(screen.getByPlaceholderText('再次输入 PIN'), '123457')
    expect(await screen.findByText('两次输入的 PIN 不一致')).toBeInTheDocument()
  })

  it('修正输入后即时提示消失，提交成功调用 onSetup', async () => {
    const user = userEvent.setup()
    const { onSetup } = setup()
    const newPin = screen.getByPlaceholderText('4-32 个字符')
    const confirm = screen.getByPlaceholderText('再次输入 PIN')
    await user.type(newPin, '123456')
    await user.type(confirm, '123457')
    expect(screen.getByText('两次输入的 PIN 不一致')).toBeInTheDocument()
    // 清空确认框重输一致值 → 提示消失
    await user.clear(confirm)
    await user.type(confirm, '123456')
    expect(screen.queryByText('两次输入的 PIN 不一致')).toBeNull()
    await user.click(screen.getByRole('button', { name: '启用锁定' }))
    await vi.waitFor(() => expect(onSetup).toHaveBeenCalledWith(undefined, '123456'))
  })
})
