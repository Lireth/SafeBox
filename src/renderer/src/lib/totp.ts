/**
 * RFC 6238 TOTP 引擎（纯本地计算，零网络依赖）
 * - 支持解析 otpauth:// 链接与裸 Base32 秘钥
 * - 算法固定为业界默认参数：HMAC-SHA1 / 6 位数字 / 30 秒步长（Google Authenticator 兼容）
 * - 秘钥格式校验与 electron/vault.ts 的 normalizeTotp 保持一致（后者为存储侧最小实现）
 */

export const TOTP_PERIOD_SECONDS = 30
export const TOTP_DIGITS = 6

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * 解析用户输入的 TOTP 秘钥，返回规范化 Base32 秘钥（大写、无填充、无分隔符）。
 * 支持 otpauth://totp/...?secret=XXX 链接与裸 Base32 字符串。
 * 非法输入抛出中文错误（直接展示给用户）。
 */
export function parseTOTPSecret(input: string): string {
  if (typeof input !== 'string') throw new Error('TOTP 秘钥格式错误')
  const trimmed = input.trim()
  if (!trimmed) throw new Error('请输入 TOTP 秘钥')
  if (trimmed.length > 500) throw new Error('TOTP 秘钥过长')

  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      throw new Error('otpauth 链接格式错误')
    }
    if (url.protocol !== 'otpauth:') throw new Error('otpauth 链接格式错误')
    if (url.host.toLowerCase() !== 'totp') {
      throw new Error('仅支持 totp 类型（不支持 hotp 计数器模式）')
    }
    const secret = url.searchParams.get('secret')
    if (!secret) throw new Error('otpauth 链接缺少 secret 参数')
    return normalizeBase32(secret)
  }

  return normalizeBase32(trimmed)
}

/** Base32 规范化：去空格/连字符、大写、去填充，并校验字符集与长度 */
function normalizeBase32(raw: string): string {
  const compact = raw.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  if (compact.length < 8) throw new Error('TOTP 秘钥过短（至少 8 个 Base32 字符）')
  if (compact.length > 128) throw new Error('TOTP 秘钥过长')
  for (const ch of compact) {
    if (!BASE32_ALPHABET.includes(ch)) {
      throw new Error(`TOTP 秘钥包含非法字符：${ch}（Base32 仅允许 A-Z 和 2-7）`)
    }
  }
  return compact
}

/** Base32 解码为字节（RFC 4648，无填充输入也接受） */
function base32Decode(secret: string): Uint8Array<ArrayBuffer> {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of secret) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error('TOTP 秘钥不是有效的 Base32')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >>> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

/** 计算当前 TOTP 码（6 位，含前导零）。now 为毫秒时间戳。 */
export async function totpCode(secret: string, now: number = Date.now()): Promise<string> {
  const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS)
  return hotp(base32Decode(normalizeBase32(secret)), counter)
}

/** RFC 4226 HOTP：HMAC-SHA1 + 动态截断 */
async function hotp(key: Uint8Array<ArrayBuffer>, counter: number): Promise<string> {
  // 8 字节大端计数器
  const message = new Uint8Array(8)
  let rest = counter
  for (let i = 7; i >= 0; i--) {
    message[i] = rest & 0xff
    rest = Math.floor(rest / 256)
  }

  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, message))

  // 动态截断（RFC 4226 5.3）
  const offset = mac[mac.length - 1] & 0x0f
  const binary =
    ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) | ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff)
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

/** 当前 30 秒窗口内剩余秒数（用于倒计时展示） */
export function totpRemainingSeconds(now: number = Date.now()): number {
  return TOTP_PERIOD_SECONDS - Math.floor((now / 1000) % TOTP_PERIOD_SECONDS)
}
