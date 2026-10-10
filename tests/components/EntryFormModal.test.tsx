import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EntryFormModal } from '../../src/renderer/src/components/EntryFormModal'
import type { AccountEntry } from '../../shared/types'

function setup(entry: AccountEntry | null = null) {
  const onSubmit = vi.fn<(draft: unknown) => Promise<void>>().mockResolvedValue()
  render(<EntryFormModal entry={entry} onClose={() => {}} onSubmit={onSubmit} />)
  return { onSubmit }
}

afterEach(() => {
  cleanup()
})

describe('EntryFormModal 名称必填即时提示（O22）', () => {
  it('初始新增不显示错误（避免打开即报错）', () => {
    setup()
    expect(screen.queryByText('请填写账号名称')).toBeNull()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
  })

  it('名称失焦且为空时显示必填提示；填写后提示消失且按钮启用', async () => {
    const user = userEvent.setup()
    setup()
    const title = screen.getByPlaceholderText('如：GitHub、公司邮箱')
    await user.click(title)
    await user.tab() // 失焦（仍为空）→ 即时提示
    expect(screen.getByText('请填写账号名称')).toBeInTheDocument()
    await user.type(title, 'GitHub')
    expect(screen.queryByText('请填写账号名称')).toBeNull()
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()
  })
})
