import { describe, expect, it } from 'vitest'
import { DEFAULT_PASSPHRASE, PASSPHRASE_WORDS, generatePassphrase, randBelow } from '../../src/renderer/src/lib/password'

describe('generatePassphrase（F20 口令短语）', () => {
  it('词表完整性：256 个互异词，均为 3-6 位小写字母（8 bit/词熵）', () => {
    expect(PASSPHRASE_WORDS).toHaveLength(256)
    expect(new Set(PASSPHRASE_WORDS).size).toBe(256)
    for (const word of PASSPHRASE_WORDS) {
      expect(word).toMatch(/^[a-z]{3,6}$/)
    }
  })

  it('默认配置生成 5 词 + 两位数字后缀，分隔符连接', () => {
    for (let i = 0; i < 32; i++) {
      const phrase = generatePassphrase(DEFAULT_PASSPHRASE)
      const parts = phrase.split('-')
      expect(parts).toHaveLength(6) // 5 词 + 1 数字
      expect(parts[5]).toMatch(/^\d{2}$/)
      for (let w = 0; w < 5; w++) {
        expect(PASSPHRASE_WORDS).toContain(parts[w].toLowerCase())
        // 首字母大写：首字符大写、其余小写
        expect(parts[w][0]).toMatch(/[A-Z]/)
        expect(parts[w].slice(1)).toBe(parts[w].slice(1).toLowerCase())
      }
    }
  })

  it('词数收敛到 3-8；选项可关闭；空分隔符回落 -', () => {
    const min = generatePassphrase({ count: 0, separator: '.', capitalize: false, appendNumber: false })
    expect(min.split('.')).toHaveLength(3)
    const max = generatePassphrase({ count: 99, separator: '_', capitalize: false, appendNumber: false })
    expect(max.split('_')).toHaveLength(8)
    const plain = generatePassphrase({ count: 4, separator: '', capitalize: false, appendNumber: false })
    expect(plain.split('-')).toHaveLength(4)
    expect(plain).toMatch(/^[a-z]+(-[a-z]+){3}$/)
  })

  it('均匀性：256 词大样本下单词分布无系统性偏置（randBelow 拒绝采样，2 的幂无重采）', () => {
    const trials = 256 * 40
    const counts = new Map<string, number>()
    for (let i = 0; i < trials; i++) {
      const word = PASSPHRASE_WORDS[randBelow(PASSPHRASE_WORDS.length)]
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
    expect(counts.size).toBeGreaterThan(200) // 10240 次采样覆盖绝大多数词
    const expected = trials / 256
    for (const count of counts.values()) {
      // 8 bit/词均匀分布：单格 6σ 界（期望 40，σ≈6.3）
      expect(Math.abs(count - expected)).toBeLessThan(40)
    }
  })
})
