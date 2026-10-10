import { describe, expect, it } from 'vitest'
import { SafeBoxError, toIpcError } from '../../electron/errors'

describe('SafeBoxError / toIpcError（O31 错误码信封）', () => {
  it('message 保持中文兜底（主进程单测与日志不受影响），code/params 随实例携带', () => {
    const err = new SafeBoxError('FIELD_TOO_LONG', '名称过长（最多 100 字符）', { field: 'title', max: 100 })
    expect(err.message).toBe('名称过长（最多 100 字符）')
    expect(err.code).toBe('FIELD_TOO_LONG')
    expect(err.params).toEqual({ field: 'title', max: 100 })
    expect(err instanceof Error).toBe(true)
  })

  it('toIpcError 序列化为 JSON 信封；无参数时省略 params', () => {
    const withParams = toIpcError(new SafeBoxError('PIN_LENGTH', 'PIN 长度需为 4-32 个字符', { min: 4, max: 32 }))
    expect((withParams as Error).message).toBe('{"code":"PIN_LENGTH","params":{"min":4,"max":32}}')
    const noParams = toIpcError(new SafeBoxError('LOCKED', '应用已锁定，请先解锁'))
    expect((noParams as Error).message).toBe('{"code":"LOCKED"}')
  })

  it('非 SafeBoxError 原样透传（意外错误保持原始 message）', () => {
    const plain = new Error('boom')
    expect(toIpcError(plain)).toBe(plain)
    expect(toIpcError('raw')).toBe('raw')
    expect(toIpcError(undefined)).toBeUndefined()
  })
})
