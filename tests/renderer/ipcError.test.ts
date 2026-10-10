import { describe, expect, it } from 'vitest'
import { readErrorPayload, resolveIpcError } from '../../src/renderer/src/lib/ipcError'

describe('resolveIpcError（O31 错误码本地化）', () => {
  it('解析信封并按 code 渲染中文文案（测试环境语言恒为 zh）', () => {
    const err = new Error('{"code":"PIN_WRONG"}')
    expect(resolveIpcError(err, 'fallback')).toBe('PIN 不正确')
  })

  it('插值参数渲染（PIN_RATE_LIMITED / PIN_LENGTH）', () => {
    expect(resolveIpcError(new Error('{"code":"PIN_RATE_LIMITED","params":{"seconds":30}}'), 'x')).toBe(
      '尝试过于频繁，请 30 秒后再试',
    )
    expect(resolveIpcError(new Error('{"code":"PIN_LENGTH","params":{"min":4,"max":32}}'), 'x')).toBe(
      'PIN 长度需为 4-32 个字符',
    )
  })

  it('field 参数为稳定键名：先经 error.field.* 转本地化字段名再插值', () => {
    const err = new Error('{"code":"FIELD_TOO_LONG","params":{"field":"title","max":100}}')
    expect(resolveIpcError(err, 'x')).toBe('名称过长（最多 100 字符）')
  })

  it('非信封错误原样透传原始 message；空 message 用 fallback', () => {
    expect(resolveIpcError(new Error('boom'), 'fallback')).toBe('boom')
    expect(resolveIpcError(new Error(''), 'fallback')).toBe('fallback')
    expect(resolveIpcError('raw-string', 'fallback')).toBe('fallback')
    expect(resolveIpcError(undefined, 'fallback')).toBe('fallback')
  })

  it('畸形信封（params 非对象 / JSON 损坏）不击穿解析', () => {
    expect(readErrorPayload(new Error('{"code":"X","params":"bad"}'))).toBeNull()
    expect(readErrorPayload(new Error('{"code":'))).toBeNull()
    expect(readErrorPayload(new Error('{"code":123}'))).toBeNull()
  })

  it('readErrorPayload 对合法信封返回结构化载荷', () => {
    const payload = readErrorPayload(new Error('{"code":"LOCKED"}'))
    expect(payload).toEqual({ code: 'LOCKED' })
  })
})
