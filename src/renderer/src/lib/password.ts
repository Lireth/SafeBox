/** 密码生成与强度评估（渲染端本地完成，不经过网络） */

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
  symbols: '!@#$%^&*()-_=+[]{};:,.?'
}

/** 使用 crypto.getRandomValues 生成密码，保证选中的每类字符至少出现一次 */
export function generatePassword(options: GeneratorOptions): string {
  const groups: string[] = []
  if (options.upper) groups.push(CHARSETS.upper)
  if (options.lower) groups.push(CHARSETS.lower)
  if (options.digits) groups.push(CHARSETS.digits)
  if (options.symbols) groups.push(CHARSETS.symbols)
  if (groups.length === 0) return ''

  const length = Math.max(options.length, groups.length)
  const all = groups.join('')
  const random = new Uint32Array(length)
  crypto.getRandomValues(random)

  const chars: string[] = []
  // 先保证每类至少一个
  groups.forEach((group, i) => {
    chars.push(group[random[i] % group.length])
  })
  // 剩余位从全集中取
  for (let i = groups.length; i < length; i++) {
    chars.push(all[random[i] % all.length])
  }
  // 洗牌打乱顺序
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random[i] % (i + 1)
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
  if (!password) return { score: 0, label: '未设置' }
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length
  if (variety >= 2) score++
  if (variety >= 3 && password.length >= 10) score++
  const labels = ['很弱', '较弱', '一般', '较强', '很强']
  return { score: Math.min(score, 4) as PasswordStrength['score'], label: labels[Math.min(score, 4)] }
}
