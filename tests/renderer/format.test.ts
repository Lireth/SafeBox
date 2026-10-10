import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, maskPassword } from '../../src/renderer/src/lib/format'

describe('formatDate（仅日期）', () => {
  it('时间戳渲染为 zh-CN 日期', () => {
    // 用固定 UTC 时间戳：断言仅包含日期部分（时区差异下年月日可能偏移，故不锁死具体值）
    const ts = Date.UTC(2026, 0, 15)
    const out = formatDate(ts)
    expect(out).toMatch(/2026/)
    expect(out).not.toMatch(/:\d{2}/) // 不含时间部分
  })
})

describe('formatDateTime（日期 + 时间，24 小时制）', () => {
  it('时间戳渲染为 zh-CN 日期时间', () => {
    const ts = Date.UTC(2026, 0, 15, 8, 30)
    const out = formatDateTime(ts)
    expect(out).toMatch(/2026/)
    expect(out).toMatch(/:\d{2}/) // 含时间部分
  })
})

describe('maskPassword（圆点掩码）', () => {
  it('长度不足上限时按实际长度掩码', () => {
    expect(maskPassword('abc')).toBe('•••')
  })

  it('超过上限时截断到 12 位', () => {
    expect(maskPassword('a'.repeat(20))).toBe('•'.repeat(12))
  })

  it('自定义上限生效', () => {
    expect(maskPassword('abcdef', 4)).toBe('••••')
  })
})
