import { describe, expect, it } from 'vitest'
import { buildOtpauthUrl, parseTOTPSecret, parseTotpParams, totpCode, totpRemainingSeconds } from '../../src/renderer/src/lib/totp'

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

/** ASCII 字符串 → Base32（RFC 4648，测试向量秘钥编码用） */
function b32(ascii: string): string {
  const bytes = Buffer.from(ascii, 'ascii')
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += ALPHABET[(value >>> bits) & 31]
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

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

  it('自定义周期窗口边界（period=60，F18）', () => {
    expect(totpRemainingSeconds(45_000, 60)).toBe(15)
    expect(totpRemainingSeconds(59_999, 60)).toBe(1)
    expect(totpRemainingSeconds(60_000, 60)).toBe(60)
  })
})

describe('parseTotpParams（otpauth 参数解析，F18）', () => {
  it('提取 period/digits/algorithm，algorithm 大小写与连字符归一', () => {
    expect(parseTotpParams('otpauth://totp/x?secret=abcd2345abcd&period=60&digits=8&algorithm=sha-256')).toEqual({
      secret: 'ABCD2345ABCD',
      period: 60,
      digits: 8,
      algorithm: 'SHA256',
    })
  })

  it('裸 Base32 视为全默认参数（30/6/SHA1）', () => {
    expect(parseTotpParams('abcd2345abcd')).toEqual({ secret: 'ABCD2345ABCD', period: 30, digits: 6, algorithm: 'SHA1' })
  })

  it('参数缺省回落默认；边界 period 1 与 3600 合法', () => {
    expect(parseTotpParams('otpauth://totp/x?secret=abcd2345abcd&digits=8').digits).toBe(8)
    expect(parseTotpParams('otpauth://totp/x?secret=abcd2345abcd&period=1').period).toBe(1)
    expect(parseTotpParams('otpauth://totp/x?secret=abcd2345abcd&period=3600').period).toBe(3600)
  })

  it('非法参数抛本地化错误', () => {
    expect(() => parseTotpParams('otpauth://totp/x?secret=abcd2345abcd&period=0')).toThrow('周期')
    expect(() => parseTotpParams('otpauth://totp/x?secret=abcd2345abcd&period=abc')).toThrow('周期')
    expect(() => parseTotpParams('otpauth://totp/x?secret=abcd2345abcd&period=3601')).toThrow('周期')
    expect(() => parseTotpParams('otpauth://totp/x?secret=abcd2345abcd&period=30.5')).toThrow('周期')
    expect(() => parseTotpParams('otpauth://totp/x?secret=abcd2345abcd&digits=7')).toThrow('位数')
    expect(() => parseTotpParams('otpauth://totp/x?secret=abcd2345abcd&algorithm=md5')).toThrow('算法')
  })
})

describe('totpCode 自定义参数（RFC 6238 附录 B 完整向量，F18）', () => {
  // 8 位码 = 动态截断值 % 10^8；6 位码为其后 6 位（模传递），与既有 59s → 287082 相互印证
  it('SHA1 / 8 位：T=59s → 94287082（与 6 位向量 287082 同源互证）', async () => {
    expect(await totpCode(RFC_KEY_B32, 59_000, { digits: 8 })).toBe('94287082')
  })

  it('SHA256 / 8 位：T=59s → 46119246', async () => {
    // RFC 6238 SHA256 秘钥 = ASCII "12345678901234567890123456789012"（32 字节）
    expect(await totpCode(b32('12345678901234567890123456789012'), 59_000, { digits: 8, algorithm: 'SHA256' })).toBe('46119246')
  })

  it('SHA512 / 8 位：T=59s → 90693936', async () => {
    // RFC 6238 SHA512 秘钥 = ASCII "1234567890123456789012345678901234567890123456789012345678901234"（64 字节）
    expect(
      await totpCode(b32('1234567890123456789012345678901234567890123456789012345678901234'), 59_000, {
        digits: 8,
        algorithm: 'SHA512',
      }),
    ).toBe('90693936')
  })

  it('period=60：窗口计数按 60 秒步进（F18）', async () => {
    // T=59s、59.999s 同属 counter 0（[0,60s)）→ RFC 4226 HOTP(counter=0) 经典值 755224
    expect(await totpCode(RFC_KEY_B32, 59_000, { period: 60 })).toBe('755224')
    expect(await totpCode(RFC_KEY_B32, 59_999, { period: 60 })).toBe('755224')
    // T=60s 仍在 counter 1（与默认 30s 下 T=59s 同 counter）→ 287082
    expect(await totpCode(RFC_KEY_B32, 60_000, { period: 60 })).toBe('287082')
    // T=120s 进入 counter 2 → 与默认 30s 下 T=60s 同 counter 2
    expect(await totpCode(RFC_KEY_B32, 120_000, { period: 60 })).toBe(await totpCode(RFC_KEY_B32, 60_000))
  })
})

describe('buildOtpauthUrl（编辑回填链接重建，F18）', () => {
  it('带自定义参数的条目重建为 otpauth 链接，且经 parseTotpParams 无损还原', () => {
    const entry = { title: 'GitHub', totpSecret: 'ABCD2345ABCD', totpPeriod: 60, totpDigits: 8, totpAlgorithm: 'SHA256' as const }
    const rebuilt = buildOtpauthUrl(entry)
    expect(rebuilt).toContain('secret=ABCD2345ABCD')
    expect(rebuilt).toContain('period=60')
    expect(rebuilt).toContain('digits=8')
    expect(rebuilt).toContain('algorithm=SHA256')
    expect(parseTotpParams(rebuilt as string)).toEqual({ secret: 'ABCD2345ABCD', period: 60, digits: 8, algorithm: 'SHA256' })
  })

  it('全默认参数返回裸 Base32；无秘钥返回 undefined', () => {
    expect(buildOtpauthUrl({ title: 'X', totpSecret: 'ABCD2345ABCD' })).toBe('ABCD2345ABCD')
    expect(buildOtpauthUrl({ title: 'X', totpSecret: 'ABCD2345ABCD', totpPeriod: 30, totpDigits: 6 })).toBe('ABCD2345ABCD')
    expect(buildOtpauthUrl({ title: 'X' })).toBeUndefined()
  })
})
