import { describe, expect, it } from 'vitest'
import { generatePassword, passwordStrength } from '../../src/renderer/src/lib/password'

/** 与 password.ts 中 CHARSETS 保持一致的合法字符集（排除易混淆字符） */
const ALL_CHARS = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()\-_=+[\]{};:,.?]+$/

describe('generatePassword 生成器不变量', () => {
  it('全部字符组关闭时返回空字符串', () => {
    expect(generatePassword({ length: 16, upper: false, lower: false, digits: false, symbols: false })).toBe('')
  })

  it('长度不足已启用组数时提升到组数', () => {
    expect(generatePassword({ length: 2, upper: true, lower: true, digits: true, symbols: true })).toHaveLength(4)
  })

  it('常规请求返回精确长度', () => {
    expect(generatePassword({ length: 8, upper: true, lower: true, digits: false, symbols: false })).toHaveLength(8)
    expect(generatePassword({ length: 64, upper: true, lower: true, digits: true, symbols: true })).toHaveLength(64)
  })

  it('生成结果只包含选中字符组的字符', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword({ length: 24, upper: true, lower: true, digits: true, symbols: true })
      expect(pw).toMatch(ALL_CHARS)
    }
  })

  it('未选中的字符类型不会出现', () => {
    expect(generatePassword({ length: 32, upper: false, lower: false, digits: true, symbols: false })).toMatch(/^[2-9]+$/)
    expect(generatePassword({ length: 32, upper: false, lower: true, digits: false, symbols: false })).toMatch(/^[a-km-z]+$/)
    expect(generatePassword({ length: 32, upper: true, lower: false, digits: false, symbols: false })).toMatch(/^[A-HJ-NP-Z]+$/)
  })

  it('不包含易混淆字符（l / I / O / 0 / 1）', () => {
    for (let i = 0; i < 100; i++) {
      const pw = generatePassword({ length: 32, upper: true, lower: true, digits: true, symbols: true })
      expect(pw).not.toMatch(/[lIO01]/)
    }
  })

  it('每个选中的字符组至少出现一次', () => {
    for (let i = 0; i < 30; i++) {
      const pw = generatePassword({ length: 16, upper: true, lower: true, digits: true, symbols: true })
      expect(pw).toMatch(/[A-Z]/)
      expect(pw).toMatch(/[a-z]/)
      expect(pw).toMatch(/[2-9]/)
      expect(pw).toMatch(/[^A-Za-z0-9]/)
    }
  })
})

describe('passwordStrength 强度分级', () => {
  it('空密码返回未设置', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: '未设置' })
  })

  it('短且单一字符集为很弱', () => {
    expect(passwordStrength('abc')).toEqual({ score: 0, label: '很弱' })
  })

  it('8 位单一字符集得 1 分（较弱）', () => {
    expect(passwordStrength('abcdefgh')).toEqual({ score: 1, label: '较弱' })
  })

  it('8 位含三类字符得 2 分（一般）', () => {
    expect(passwordStrength('Abcdefg1')).toEqual({ score: 2, label: '一般' })
  })

  it('12 位两类字符得 3 分（较强）', () => {
    expect(passwordStrength('abcdefgh1234')).toEqual({ score: 3, label: '较强' })
  })

  it('10 位含全部四类字符得 3 分（较强）', () => {
    expect(passwordStrength('Abcdefg12!')).toEqual({ score: 3, label: '较强' })
  })

  it('12 位含全部四类字符得满分（很强）', () => {
    expect(passwordStrength('Abcdefghij1!')).toEqual({ score: 4, label: '很强' })
  })
})
