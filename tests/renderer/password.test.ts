import { describe, expect, it } from 'vitest'
import { generatePassword, passwordStrength, randBelow } from '../../src/renderer/src/lib/password'

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
    expect(generatePassword({ length: 32, upper: false, lower: false, digits: true, symbols: false })).toMatch(
      /^[2-9]+$/,
    )
    expect(generatePassword({ length: 32, upper: false, lower: true, digits: false, symbols: false })).toMatch(
      /^[a-km-z]+$/,
    )
    expect(generatePassword({ length: 32, upper: true, lower: false, digits: false, symbols: false })).toMatch(
      /^[A-HJ-NP-Z]+$/,
    )
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

describe('randBelow 拒绝采样（消除取模偏置）', () => {
  /** 用脚本化的 32 位随机值序列替换 getRandomValues，使拒绝路径可确定性验证 */
  function withScriptedRandom<T>(values: number[], fn: () => T): T {
    type Fill = (buf: Uint32Array) => Uint32Array
    const proto = Object.getPrototypeOf(globalThis.crypto) as { getRandomValues: Fill }
    const original = proto.getRandomValues
    let index = 0
    proto.getRandomValues = (buf: Uint32Array): Uint32Array => {
      for (let i = 0; i < buf.length; i++) buf[i] = values[index++] ?? values[values.length - 1]
      return buf
    }
    try {
      return fn()
    } finally {
      proto.getRandomValues = original
    }
  }

  it('非法参数抛错', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, 4294967297]) {
      expect(() => randBelow(bad)).toThrow()
    }
  })

  it('n=1 恒返回 0', () => {
    expect(randBelow(1)).toBe(0)
  })

  it('落在 [limit, 2^32) 的尾部值被丢弃重采', () => {
    // n=3 → limit=floor(2^32/3)*3=4294967295；首个值 4294967295≥limit 被拒，次值 10 接受 → 10%3=1
    expect(withScriptedRandom([4294967295, 10], () => randBelow(3))).toBe(1)
  })

  it('恰在 limit 边界被拒，limit-1 被接受', () => {
    // n=2 → limit=4294967296（2^32 是 2 的整数倍，无偏置，全部接受）；改用 n=5 → limit=4294967295
    // 4294967294 < limit(4294967295) 接受 → %5=4；4294967295 ≥ limit 拒绝，重采 0 → 0
    expect(withScriptedRandom([4294967294], () => randBelow(5))).toBe(4)
    expect(withScriptedRandom([4294967295, 0], () => randBelow(5))).toBe(0)
  })

  it('取值始终落在 [0, n) 内', () => {
    for (const n of [2, 3, 8, 23, 24, 25, 62, 64, 100]) {
      for (let i = 0; i < 200; i++) {
        const v = randBelow(n)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(n)
        expect(Number.isInteger(v)).toBe(true)
      }
    }
  })

  it('大样本均匀性：卡方检验通过（n=3 与 n=25）', () => {
    // 显著性水平 0.001 对应的卡方临界值（df=k-1）
    const chiSquareCritical: Record<number, number> = { 2: 13.82, 24: 51.18 }
    for (const n of [3, 25]) {
      const total = 100_000
      const buckets = new Array<number>(n).fill(0)
      for (let i = 0; i < total; i++) buckets[randBelow(n)]++
      const expected = total / n
      let chi = 0
      for (const count of buckets) chi += (count - expected) ** 2 / expected
      // 严格均匀分布下 chi 远超临界值的概率 < 0.1%，取模偏置在 n=3 时会让首桶显著偏高
      expect(chi).toBeLessThan(chiSquareCritical[n - 1])
    }
  })
})

describe('generatePassword 分布均匀性', () => {
  // 单字符组：每个位置都从同一集合均匀取值（含「每类至少一个」与洗牌），
  // 无跨组配额偏置，可对组内各字符做严格均匀性检验。
  it('单一字符组大样本频率接近期望（卡方检验）', () => {
    const pwLen = 16
    const samples = 20_000
    const total = pwLen * samples
    const freq = new Map<string, number>()
    for (let i = 0; i < samples; i++) {
      // 仅启用 digits（8 个字符：23456789）
      const pw = generatePassword({ length: pwLen, upper: false, lower: false, digits: true, symbols: false })
      expect(pw).toHaveLength(pwLen)
      for (const ch of pw) freq.set(ch, (freq.get(ch) ?? 0) + 1)
    }
    const alphabet = 8
    expect(freq.size).toBe(alphabet)
    const expected = total / alphabet
    let chi = 0
    for (const count of freq.values()) chi += (count - expected) ** 2 / expected
    // df=7，α=0.001 卡方临界值约 24.3（取 40 留足裕度，避免偶发波动误红）
    expect(chi).toBeLessThan(40)
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
