import { describe, expect, it } from 'vitest'
import { auditEntries, countRiskyEntries, STALE_THRESHOLD_MS } from '../../src/renderer/src/lib/audit'
import type { AccountEntry } from '../../shared/types'

const NOW = Date.now()

function entry(overrides: Partial<AccountEntry> = {}): AccountEntry {
  return {
    id: overrides.title ?? Math.random().toString(),
    title: '账号',
    category: 'other',
    url: '',
    username: '',
    password: '',
    notes: '',
    favorite: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('auditEntries 弱密码检测', () => {
  it('强度评分 ≤ 1 的密码被检出', async () => {
    const report = await auditEntries([
      entry({ id: 'a', title: '弱密码', password: 'abc' }), // score 0
      entry({ id: 'b', title: '较弱', password: 'abcdefgh' }), // score 1
      entry({ id: 'c', title: '较强', password: 'Abcdefg12!' }), // score 3
    ])
    expect(report.weak.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('未设置密码的条目不参与弱密码判定', async () => {
    const report = await auditEntries([entry({ id: 'a', password: '' })])
    expect(report.weak).toEqual([])
  })
})

describe('auditEntries 重复密码检测', () => {
  it('相同密码分组，不同密码不分组', async () => {
    const report = await auditEntries([
      entry({ id: 'a', title: 'A', password: 'same-password-1' }),
      entry({ id: 'b', title: 'B', password: 'same-password-1' }),
      entry({ id: 'c', title: 'C', password: 'different-2' }),
    ])
    expect(report.duplicateGroups).toHaveLength(1)
    expect(report.duplicateGroups[0].map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('多组重复并行检出', async () => {
    const report = await auditEntries([
      entry({ id: 'a', password: 'pwd-group-one' }),
      entry({ id: 'b', password: 'pwd-group-one' }),
      entry({ id: 'c', password: 'pwd-group-two-x' }),
      entry({ id: 'd', password: 'pwd-group-two-x' }),
      entry({ id: 'e', password: 'unique-here' }),
    ])
    expect(report.duplicateGroups).toHaveLength(2)
  })

  it('空密码不参与重复比对', async () => {
    const report = await auditEntries([entry({ id: 'a', password: '' }), entry({ id: 'b', password: '' })])
    expect(report.duplicateGroups).toEqual([])
  })
})

describe('auditEntries 久未更新检测', () => {
  it('更新时间超过 6 个月检出', async () => {
    const report = await auditEntries([
      entry({ id: 'old', updatedAt: NOW - STALE_THRESHOLD_MS - 1 }),
      entry({ id: 'recent', updatedAt: NOW - STALE_THRESHOLD_MS + 86_400_000 }),
      entry({ id: 'fresh', updatedAt: NOW }),
    ])
    expect(report.stale.map((e) => e.id)).toEqual(['old'])
  })

  it('与密码强弱无关，仅看更新时间', async () => {
    const report = await auditEntries([
      entry({ id: 'a', password: 'Abcdefghij1!', updatedAt: NOW - STALE_THRESHOLD_MS - 1 }),
    ])
    expect(report.stale.map((e) => e.id)).toEqual(['a'])
  })
})

describe('auditEntries 汇总', () => {
  it('全健康时三类结果为空', async () => {
    const report = await auditEntries([
      entry({ id: 'a', password: 'Abcdefghij1!' }),
      entry({ id: 'b', password: 'Str0ng!Passphrase' }),
    ])
    expect(report.weak).toEqual([])
    expect(report.duplicateGroups).toEqual([])
    expect(report.stale).toEqual([])
    expect(report.scanned).toBe(2)
    expect(countRiskyEntries(report)).toBe(0)
  })

  it('空账号列表返回空报告', async () => {
    const report = await auditEntries([])
    expect(report.scanned).toBe(0)
    expect(countRiskyEntries(report)).toBe(0)
  })

  it('同一账号命中多维度时风险计数去重', async () => {
    const weakAndStale = entry({ id: 'x', password: 'abc', updatedAt: NOW - STALE_THRESHOLD_MS - 1 })
    const report = await auditEntries([weakAndStale, entry({ id: 'y', password: 'abc' })])
    // x：弱 + 久未更新；y：与 x 重复 → 涉及条目 = x, y
    expect(countRiskyEntries(report)).toBe(2)
  })
})
