/** 密码生成与强度评估（渲染端本地完成，不经过网络） */
import { t } from './i18n'

export interface GeneratorOptions {
  length: number
  upper: boolean
  lower: boolean
  digits: boolean
  symbols: boolean
}

const CHARSETS = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lower: 'abcdefghijkmnopqrstuvwxyz',
  digits: '23456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
}

/**
 * 拒绝采样生成 [0, n) 均匀随机整数（消除取模偏置，issue #28）。
 *
 * 直接 `random % n` 会让靠前的余数类多分到 2^32 mod n 个取值，分布不均。
 * 这里取上界 `limit = floor(2^32 / n) * n`（n 的最大整数倍），落在 [limit, 2^32)
 * 的尾部值一律丢弃重采，剩余区间恰好被 n 均分，输出严格均匀。
 * 重采概率 < n / 2^32（本模块 n ≤ 25，约 6e-9），实际几乎不会循环。
 *
 * 导出仅为便于随机性审计单测，业务代码不应直接使用。
 */
export function randBelow(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 4294967296) throw new Error(`randBelow 参数需为 1~2^32 整数，收到 ${n}`)
  const limit = Math.floor(4294967296 / n) * n
  const buf = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buf)
    value = buf[0]
  } while (value >= limit)
  return value % n
}

/** 使用 crypto 随机源生成密码，保证选中的每类字符至少出现一次，且字符分布严格均匀 */
export function generatePassword(options: GeneratorOptions): string {
  const groups: string[] = []
  if (options.upper) groups.push(CHARSETS.upper)
  if (options.lower) groups.push(CHARSETS.lower)
  if (options.digits) groups.push(CHARSETS.digits)
  if (options.symbols) groups.push(CHARSETS.symbols)
  if (groups.length === 0) return ''

  const length = Math.max(options.length, groups.length)
  const all = groups.join('')

  const chars: string[] = []
  // 先保证每类至少一个（每次取值独立，不复用随机数）
  for (const group of groups) {
    chars.push(group[randBelow(group.length)])
  }
  // 剩余位从全集中取
  for (let i = groups.length; i < length; i++) {
    chars.push(all[randBelow(all.length)])
  }
  // Fisher-Yates 洗牌打乱顺序：j 均匀取自 [0, i]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randBelow(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4
  label: string
}

/** 简单启发式强度评估：长度 + 字符种类 */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: t('strength.notSet') }
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length
  if (variety >= 2) score++
  if (variety >= 3 && password.length >= 10) score++
  const capped = Math.min(score, 4) as PasswordStrength['score']
  const keys = ['veryWeak', 'weak', 'fair', 'strong', 'veryStrong'] as const
  return { score: capped, label: t(`strength.${keys[capped]}`) }
}

/**
 * 口令短语词表（F20）：256 个 3-6 字母常用英文短词。
 * 词表大小取 2 的幂（log2(256)=8 bit/词），选中分布严格均匀（randBelow 无重采）；
 * 本地内嵌零网络。导出仅为词表完整性单测（数量/唯一性/字符集），业务代码不应直接使用。
 */
export const PASSPHRASE_WORDS: readonly string[] = [
  'apple', 'amber', 'angel', 'arrow', 'atlas', 'audio', 'autumn', 'azure', 'bacon', 'badge', 'baker', 'balmy', 'bamboo', 'banjo', 'basic', 'beach',
  'beacon', 'beam', 'bear', 'beat', 'berry', 'birch', 'bison', 'blaze', 'bloom', 'blond', 'bolt', 'bonus', 'booth', 'boxcar', 'brave', 'bread',
  'brick', 'bridge', 'bright', 'brook', 'brush', 'bubble', 'bucket', 'buffet', 'bunch', 'bunker', 'burst', 'butter', 'cabin', 'cactus', 'camel', 'camera',
  'candy', 'canoe', 'canvas', 'canyon', 'cargo', 'carrot', 'castle', 'catch', 'cedar', 'cello', 'chain', 'chalk', 'charm', 'cheese', 'cherry', 'chili',
  'chorus', 'cider', 'cinema', 'circle', 'citrus', 'civic', 'civil', 'claim', 'cliff', 'climb', 'clock', 'cloud', 'clover', 'cobalt', 'comet', 'coral',
  'cosmic', 'cotton', 'coyote', 'crane', 'crater', 'crayon', 'cream', 'crisp', 'crown', 'cubic', 'cumin', 'curve', 'cyber', 'daisy', 'dance', 'dawn',
  'deal', 'delta', 'demo', 'dense', 'depth', 'desk', 'diary', 'digit', 'diner', 'disco', 'ditch', 'diver', 'dock', 'dinghy', 'domain', 'donut',
  'dove', 'draft', 'dragon', 'dream', 'drift', 'drum', 'dune', 'dusk', 'eagle', 'earth', 'easel', 'echo', 'edge', 'eel', 'eight', 'elbow',
  'elder', 'elk', 'ember', 'emu', 'emoji', 'engine', 'entry', 'envoy', 'equal', 'essay', 'ether', 'ethic', 'event', 'evil', 'exact', 'exile',
  'fable', 'falcon', 'fancy', 'fawn', 'fence', 'fern', 'ferry', 'fever', 'fiber', 'fig', 'final', 'fine', 'fire', 'fjord', 'flame', 'float',
  'flock', 'flora', 'flute', 'focal', 'foggy', 'forest', 'forge', 'fossil', 'fox', 'frame', 'fresh', 'frost', 'fruit', 'fudge', 'fungi', 'fuse',
  'gadget', 'galaxy', 'gale', 'game', 'garden', 'garlic', 'gauge', 'gecko', 'gem', 'genie', 'ghost', 'giant', 'ginger', 'glade', 'glass', 'globe',
  'glove', 'gnome', 'goat', 'gold', 'goose', 'gorge', 'grape', 'grass', 'gravel', 'green', 'grill', 'grove', 'guard', 'guitar', 'gym', 'guava',
  'habit', 'hail', 'halo', 'ham', 'hammer', 'harbor', 'happy', 'harp', 'hawk', 'haze', 'hazel', 'heart', 'hedge', 'hello', 'heron', 'hill',
  'hive', 'hobby', 'honey', 'horn', 'horse', 'hotel', 'house', 'human', 'humor', 'icon', 'idea', 'igloo', 'image', 'index', 'inbox', 'iris',
  'iron', 'island', 'issue', 'ivory', 'ivy', 'jacket', 'jade', 'jaguar', 'jazz', 'jelly', 'jewel', 'joint', 'judge', 'juice', 'jumbo', 'kayak',
]

export interface PassphraseOptions {
  /** 词数（实际取 3-8 的整数） */
  count: number
  /** 词间分隔符（空串回落 '-'） */
  separator: string
  /** 单词首字母大写 */
  capitalize: boolean
  /** 末尾附加两位随机数字（00-99，+6.6 bit 熵） */
  appendNumber: boolean
}

export const DEFAULT_PASSPHRASE: PassphraseOptions = { count: 5, separator: '-', capitalize: true, appendNumber: true }

/**
 * 口令短语生成（F20）：词表均匀随机 + 可选首字母大写 + 可选两位数字后缀，分隔符连接。
 * 每次取值独立调用 randBelow（拒绝采样，严格均匀，与字符生成器同一随机纪律）。
 */
export function generatePassphrase(options: PassphraseOptions): string {
  const count = Math.max(3, Math.min(8, Math.round(options.count)))
  const separator = options.separator || '-'
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    let word = PASSPHRASE_WORDS[randBelow(PASSPHRASE_WORDS.length)]
    if (options.capitalize) word = word.charAt(0).toUpperCase() + word.slice(1)
    parts.push(word)
  }
  if (options.appendNumber) parts.push(String(randBelow(100)).padStart(2, '0'))
  return parts.join(separator)
}
