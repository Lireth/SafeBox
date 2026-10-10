/**
 * RFC 6238 TOTP 引擎（纯本地计算，零网络依赖）
 * - 支持解析 otpauth:// 链接与裸 Base32 秘钥
 * - 支持完整 otpauth 参数：period（周期秒）、digits（位数）、algorithm（SHA1/SHA256/SHA512），
 *   缺省为业界默认 30s / 6 位 / SHA1（Google Authenticator 兼容，F18）
 * - 参数校验规则与 electron/vault.ts 的 normalizeTotp 保持一致（后者为存储侧最小实现）
 * - 校验错误消息走 i18n t()（issue #33）；节点测试环境默认语言 zh，既有断言中文串保持通过
 */

import { t } from './i18n'
import type { AccountEntry } from '../../../../shared/types'

export const TOTP_PERIOD_SECONDS = 30
export const TOTP_DIGITS = 6

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

/** 解析后的完整 TOTP 参数（默认值已展开） */
export interface TotpParams {
  secret: string
  period: number
  digits: number
  algorithm: TotpAlgorithm
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** period 合法范围（秒）：覆盖 30/60 等常见值，拒绝离谱输入 */
const PERIOD_MAX = 3600

/**
 * 解析用户输入的 TOTP 秘钥及其参数。
 * 支持 otpauth://totp/...?secret=XXX&period=60&digits=8&algorithm=SHA256 链接与裸 Base32。
 * 裸 Base32 视为全默认参数（30s / 6 位 / SHA1）。非法输入抛本地化错误（直接展示给用户）。
 */
export function parseTotpParams(input: string): TotpParams {
  if (typeof input !== 'string') throw new Error(t('totpErr.format'))
  const trimmed = input.trim()
  if (!trimmed) throw new Error(t('totpErr.empty'))
  if (trimmed.length > 500) throw new Error(t('totpErr.tooLong'))

  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      throw new Error(t('totpErr.otpauthBad'))
    }
    if (url.protocol !== 'otpauth:') throw new Error(t('totpErr.otpauthBad'))
    if (url.host.toLowerCase() !== 'totp') {
      throw new Error(t('totpErr.onlyTotp'))
    }
    const secret = url.searchParams.get('secret')
    if (!secret) throw new Error(t('totpErr.noSecret'))
    return {
      secret: normalizeBase32(secret),
      period: parsePeriod(url.searchParams.get('period')),
      digits: parseDigits(url.searchParams.get('digits')),
      algorithm: parseAlgorithm(url.searchParams.get('algorithm')),
    }
  }

  return { secret: normalizeBase32(trimmed), period: TOTP_PERIOD_SECONDS, digits: TOTP_DIGITS, algorithm: 'SHA1' }
}

/** 兼容导出：仅取规范化 Base32 秘钥（参数校验副作用与 parseTotpParams 一致） */
export function parseTOTPSecret(input: string): string {
  return parseTotpParams(input).secret
}

/** otpauth period 参数解析：缺省 30；须为 1-3600 的整数 */
function parsePeriod(raw: string | null): number {
  if (raw === null || raw === '') return TOTP_PERIOD_SECONDS
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > PERIOD_MAX) throw new Error(t('totpErr.badPeriod'))
  return value
}

/** otpauth digits 参数解析：缺省 6；仅支持 6 或 8 位 */
function parseDigits(raw: string | null): number {
  if (raw === null || raw === '') return TOTP_DIGITS
  const value = Number(raw)
  if (value !== 6 && value !== 8) throw new Error(t('totpErr.badDigits'))
  return value
}

/** otpauth algorithm 参数解析：缺省 SHA1；大小写与连字符不敏感（SHA-256 → SHA256） */
function parseAlgorithm(raw: string | null): TotpAlgorithm {
  if (raw === null || raw === '') return 'SHA1'
  const value = raw.toUpperCase().replace(/-/g, '')
  if (value !== 'SHA1' && value !== 'SHA256' && value !== 'SHA512') throw new Error(t('totpErr.badAlgorithm'))
  return value
}

/** Base32 规范化：去空格/连字符、大写、去填充，并校验字符集与长度 */
function normalizeBase32(raw: string): string {
  const compact = raw.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  if (compact.length < 8) throw new Error(t('totpErr.tooShort'))
  if (compact.length > 128) throw new Error(t('totpErr.tooLong'))
  for (const ch of compact) {
    if (!BASE32_ALPHABET.includes(ch)) {
      throw new Error(t('totpErr.badChar', { ch }))
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
    if (idx === -1) throw new Error(t('totpErr.notBase32'))
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >>> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

/**
 * 计算当前 TOTP 码（含前导零）。now 为毫秒时间戳。
 * options 可指定周期 / 位数 / 算法（缺省 30s / 6 位 / SHA1）。
 */
export async function totpCode(
  secret: string,
  now: number = Date.now(),
  options?: { period?: number; digits?: number; algorithm?: TotpAlgorithm },
): Promise<string> {
  const period = options?.period ?? TOTP_PERIOD_SECONDS
  const digits = options?.digits ?? TOTP_DIGITS
  const algorithm = options?.algorithm ?? 'SHA1'
  const counter = Math.floor(now / 1000 / period)
  return hotp(base32Decode(normalizeBase32(secret)), counter, digits, algorithm)
}

/** RFC 4226 HOTP：HMAC（算法可选）+ 动态截断 */
async function hotp(
  key: Uint8Array<ArrayBuffer>,
  counter: number,
  digits: number,
  algorithm: TotpAlgorithm,
): Promise<string> {
  // 8 字节大端计数器
  const message = new Uint8Array(8)
  let rest = counter
  for (let i = 7; i >= 0; i--) {
    message[i] = rest & 0xff
    rest = Math.floor(rest / 256)
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }[algorithm] },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, message))

  // 动态截断（RFC 4226 5.3）
  const offset = mac[mac.length - 1] & 0x0f
  const binary =
    ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) | ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff)
  return String(binary % 10 ** digits).padStart(digits, '0')
}

/** 当前窗口内剩余秒数（用于倒计时展示）；period 缺省 30 */
export function totpRemainingSeconds(now: number = Date.now(), period: number = TOTP_PERIOD_SECONDS): number {
  return period - Math.floor((now / 1000) % period)
}

/**
 * 编辑表单回填：由条目重建 TOTP 原始输入（F18）。
 * 全默认参数时返回裸 Base32（保持既有观感）；带自定义参数时返回 otpauth 链接，
 * 提交后主进程可从链接重新解析出参数，避免编辑丢失 period/digits/algorithm。
 */
export function buildOtpauthUrl(
  entry: Pick<AccountEntry, 'title' | 'totpSecret' | 'totpPeriod' | 'totpDigits' | 'totpAlgorithm'>,
): string | undefined {
  if (!entry.totpSecret) return undefined
  const period = entry.totpPeriod ?? TOTP_PERIOD_SECONDS
  const digits = entry.totpDigits ?? TOTP_DIGITS
  const algorithm = entry.totpAlgorithm ?? 'SHA1'
  if (period === TOTP_PERIOD_SECONDS && digits === TOTP_DIGITS && algorithm === 'SHA1') return entry.totpSecret
  const params = new URLSearchParams({
    secret: entry.totpSecret,
    period: String(period),
    digits: String(digits),
    algorithm,
  })
  // label 取条目名称（otpauth 规范 label 仅用于展示，不影响解析）
  return `otpauth://totp/${encodeURIComponent(entry.title || 'entry')}?${params.toString()}`
}
