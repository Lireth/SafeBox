import { describe, expect, it } from 'vitest'
import { parseTOTPSecret, totpCode, totpRemainingSeconds } from '../../src/renderer/src/lib/totp'

/**
 * RFC 6238 附录 B SHA-1 标准向量（key = ASCII "12345678901234567890" 的 Base32）。
 * 6 位码 = 8 位向量的后 6 位（动态截断值 % 10^6），
 * 与 Google Authenticator 默认参数（SHA-1 / 6 位 / 30 秒）完全一致。
 */
const RFC_KEY_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const RFC_VECTORS: Array<[number, string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
]

describe('parseTOTPSecret', () => {
  it('裸 Base32：小写转大写、去空格连字符与填充', () => {
    expect(parseTOTPSecret('abcd 2345 abcd')).toBe('ABCD2345ABCD')
    expect(parseTOTPSecret('abcd-2345-abcd====')).toBe('ABCD2345ABCD')
    expect(parseTOTPSecret('  gezdgnbvgy3tqojqgez dgnbvgy3tqojq  ')).toBe(RFC_KEY_B32)
  })

  it('otpauth:// 链接提取 secret 参数', () => {
    expect(parseTOTPSecret(`otpauth://totp/GitHub:me@example.com?secret=${RFC_KEY_B32}&issuer=GitHub`)).toBe(RFC_KEY_B32)
    expect(parseTOTPSecret('OTPAUTH://totp/x?secret=abcd2345abcd')).toBe('ABCD2345ABCD')
  })

  it('拒绝非法输入', () => {
    expect(() => parseTOTPSecret('')).toThrow('请输入 TOTP 秘钥')
    expect(() => parseTOTPSecret('otpauth://hotp/x?secret=ABCD2345ABCD')).toThrow('仅支持 totp 类型')
    expect(() => parseTOTPSecret('otpauth://totp/x?issuer=Y')).toThrow('缺少 secret')
    expect(() => parseTOTPSecret('otpauth://totp/x?secret=')).toThrow('缺少 secret')
    // WHATWG URL 对非特殊协议宽容解析，坏路径不会抛错但缺少 secret
    expect(() => parseTOTPSecret('otpauth://totp/[bad')).toThrow('缺少 secret')
    expect(() => parseTOTPSecret('ABCD234!')).toThrow('Base32')
    expect(() => parseTOTPSecret('AB1')).toThrow('过短')
    expect(() => parseTOTPSecret('A'.repeat(129))).toThrow('过长')
  })
})

describe('totpCode（RFC 6238 标准向量，与 Google Authenticator 一致）', () => {
  for (const [t, expected] of RFC_VECTORS) {
    it(`T=${t}s → ${expected}`, async () => {
      expect(await totpCode(RFC_KEY_B32, t * 1000)).toBe(expected)
    })
  }

  it('otpauth 链接解析后的秘钥计算结果一致（小写输入）', async () => {
    const secret = parseTOTPSecret(`otpauth://totp/x?secret=${RFC_KEY_B32.toLowerCase()}`)
    expect(await totpCode(secret, 59_000)).toBe('287082')
  })

  it('30 秒窗口内的任意时刻产生相同码值', async () => {
    const a = await totpCode(RFC_KEY_B32, 60_000)
    const b = await totpCode(RFC_KEY_B32, 89_999)
    expect(a).toBe(b)
  })
})

describe('totpRemainingSeconds', () => {
  it('30 秒窗口边界', () => {
    expect(totpRemainingSeconds(0)).toBe(30)
    expect(totpRemainingSeconds(1000)).toBe(29)
    expect(totpRemainingSeconds(29_000)).toBe(1)
    expect(totpRemainingSeconds(30_000)).toBe(30)
    expect(totpRemainingSeconds(45_000)).toBe(15)
    expect(totpRemainingSeconds(59_999)).toBe(1)
  })
})
