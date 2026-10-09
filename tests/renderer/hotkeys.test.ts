import { describe, expect, it } from 'vitest'
import { filterForDigit, HOTKEY_LIST } from '../../src/renderer/src/lib/hotkeys'

describe('filterForDigit 数字快捷键映射', () => {
  it('Ctrl+1..8 依次对应八个分类', () => {
    const expected = ['dev', 'social', 'email', 'finance', 'shopping', 'work', 'study', 'other']
    expected.forEach((id, index) => {
      expect(filterForDigit(index + 1)).toBe(id)
    })
  })

  it('Ctrl+9 对应收藏视图', () => {
    expect(filterForDigit(9)).toBe('favorite')
  })

  it('范围外数字返回 null（不改变筛选）', () => {
    expect(filterForDigit(0)).toBeNull()
    expect(filterForDigit(10)).toBeNull()
  })
})

describe('HOTKEY_LIST 帮助数据', () => {
  it('包含全部已实现的快捷键且无重复键位', () => {
    const keys = HOTKEY_LIST.map((item) => item.keys)
    expect(new Set(keys).size).toBe(keys.length)
    // 关键项存在
    expect(keys).toContain('Ctrl + N')
    expect(keys).toContain('Ctrl + F')
    expect(keys).toContain('Ctrl + L')
    expect(keys).toContain('Ctrl + /')
    expect(keys).toContain('↑ / ↓')
    expect(keys).toContain('Enter')
    expect(keys).toContain('Esc')
    // 每项都有说明文案
    expect(HOTKEY_LIST.every((item) => item.desc.length > 0)).toBe(true)
  })
})
