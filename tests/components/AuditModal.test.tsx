import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AuditModal } from '../../src/renderer/src/components/AuditModal'
import { STALE_THRESHOLD_MS } from '../../src/renderer/src/lib/audit'
import type { AccountEntry } from '../../shared/types'

/** 构造账号条目夹具 */
function entry(overrides: Partial<AccountEntry> & { id: string; title: string; password: string }): AccountEntry {
  const now = Date.now()
  return {
    category: 'other',
    url: '',
    username: `user-${overrides.id}`,
    notes: '',
    favorite: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function setup(entries: AccountEntry[]) {
  const props = { onClose: vi.fn(), onEdit: vi.fn() }
  render(<AuditModal entries={entries} {...props} />)
  return props
}

describe('AuditModal 风险分区渲染', () => {
  it('空数据展示友好空态', async () => {
    setup([])
    expect(await screen.findByText('还没有可检查的账号')).toBeInTheDocument()
  })

  it('全部健康时展示通过概览与鼓励文案', async () => {
    setup([entry({ id: 'a', title: 'GitHub', password: 'Str0ng!Pass#Ab12' })])
    expect(await screen.findByText('已扫描 1 个账号，全部通过安全检查')).toBeInTheDocument()
    expect(screen.getByText('太棒了，未发现安全风险')).toBeInTheDocument()
    expect(screen.queryByText('弱密码')).toBeNull()
  })

  it('弱密码分区渲染条目与强度标签', async () => {
    setup([entry({ id: 'w', title: 'OldForum', password: 'abc' })])
    expect(await screen.findByText('弱密码')).toBeInTheDocument()
    expect(screen.getByText('OldForum')).toBeInTheDocument()
    expect(screen.getByText('密码强度：很弱')).toBeInTheDocument()
    expect(screen.getByText(/发现 1 个账号存在安全风险/)).toBeInTheDocument()
  })

  it('重复密码分区按组渲染共享同一密码的条目', async () => {
    setup([
      entry({ id: 'd1', title: 'ShopA', password: 'same-pass-123' }),
      entry({ id: 'd2', title: 'ShopB', password: 'same-pass-123' }),
      entry({ id: 'd3', title: 'ShopC', password: 'unique-pass-999x' }),
    ])
    expect(await screen.findByText('重复密码')).toBeInTheDocument()
    expect(screen.getByText('1 组')).toBeInTheDocument()
    expect(screen.getAllByText('与其他账号使用相同密码')).toHaveLength(2)
    expect(screen.queryByText('ShopC')).toBeNull()
  })

  it('久未更新分区渲染超 6 个月条目与最后更新时间', async () => {
    setup([
      entry({ id: 's', title: 'LegacyMail', password: 'Fresh!Passw0rd#7', updatedAt: Date.now() - STALE_THRESHOLD_MS - 86400_000 }),
    ])
    expect(await screen.findByText(/久未更新/)).toBeInTheDocument()
    expect(screen.getByText('LegacyMail')).toBeInTheDocument()
    expect(screen.getByText(/最后更新：/)).toBeInTheDocument()
  })

  it('多维度命中同一账号时概览去重计数', async () => {
    // 同一弱密码 + 久未更新：只算 1 个风险账号
    setup([entry({ id: 'm', title: 'WeakOld', password: 'abc', updatedAt: Date.now() - STALE_THRESHOLD_MS - 1 })])
    expect(await screen.findByText('已扫描 1 个账号，发现 1 个账号存在安全风险')).toBeInTheDocument()
  })

  it('点击风险条目回调 onEdit 并透传该账号', async () => {
    const user = userEvent.setup()
    const props = setup([entry({ id: 'e', title: 'Target', password: 'abc' })])
    const item = await screen.findByRole('button', { name: /Target/ })
    await user.click(item)
    expect(props.onEdit).toHaveBeenCalledTimes(1)
    expect(props.onEdit.mock.calls[0][0]).toMatchObject({ id: 'e', title: 'Target' })
  })

  it('底部注明全程本机完成', async () => {
    setup([entry({ id: 'f', title: 'Any', password: 'abc' })])
    expect(await screen.findByText('体检全程在本机完成，不会发起任何网络请求。')).toBeInTheDocument()
  })
})
