import { describe, expect, it } from 'vitest'
import { normalizeHttpUrl } from '../../electron/url'

describe('normalizeHttpUrl（O27：外部链接统一白名单）', () => {
  it('放行 http/https 并规范化输出', () => {
    expect(normalizeHttpUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(normalizeHttpUrl(' http://example.com ')).toBe('http://example.com/')
  })

  it('拒绝非 http/https 协议', () => {
    expect(() => normalizeHttpUrl('file:///C:/Windows/System32')).toThrow('仅允许')
    expect(() => normalizeHttpUrl('javascript:alert(1)')).toThrow('仅允许')
    expect(() => normalizeHttpUrl('ms-settings:windowsupdate')).toThrow('仅允许')
    expect(() => normalizeHttpUrl('ftp://example.com')).toThrow('仅允许')
  })

  it('拒绝格式非法与非字符串输入', () => {
    expect(() => normalizeHttpUrl('not a url')).toThrow('格式错误')
    expect(() => normalizeHttpUrl(123)).toThrow('格式错误')
    expect(() => normalizeHttpUrl(undefined)).toThrow('格式错误')
  })

  it('空字符串返回 null（调用方静默忽略）', () => {
    expect(normalizeHttpUrl('')).toBeNull()
    expect(normalizeHttpUrl('   ')).toBeNull()
  })
})
