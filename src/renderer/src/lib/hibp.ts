import type { AccountEntry } from '../../../../shared/types'

/**
 * 泄露密码检查（F21，opt-in）：Have I Been Pwned k-匿名查询
 * - 仅上传 SHA-1 哈希的前 5 位前缀（k-匿名协议），密码本身与其余哈希位绝不离开本机
 * - 结果按完整哈希缓存（会话级），重复扫描不重复请求
 * - 网络失败抛错由调用方兜底：审计其余三维（纯本地）不受影响
 */

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/'
/** 逐条请求间隔（毫秒）：礼貌访问，避免突发流量 */
const REQUEST_DELAY_MS = 150

const countCache = new Map<string, number>()

/** 测试用：清空会话级缓存 */
export function clearPwnedCache(): void {
  countCache.clear()
}

/** SHA-1 hex（大写，与 HIBP 前缀协议对齐） */
export async function sha1HexUpper(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/** 查询密码在 HIBP 数据库中的出现次数（0 = 未发现泄露） */
export async function fetchPwnedCount(password: string): Promise<number> {
  const hash = await sha1HexUpper(password)
  const cached = countCache.get(hash)
  if (cached !== undefined) return cached
  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5)
  const response = await fetch(`${HIBP_RANGE_URL}${prefix}`, {
    headers: { 'Add-Padding': 'true' },
  })
  if (!response.ok) throw new Error(`HIBP HTTP ${response.status}`)
  const text = await response.text()
  let count = 0
  for (const line of text.split('\n')) {
    const [suffixPart, countPart] = line.trim().split(':')
    if (suffixPart === suffix) {
      count = Number(countPart) || 0
      break
    }
  }
  countCache.set(hash, count)
  return count
}

export interface PwnedScanResult {
  /** 出现在公开泄露数据中的条目 */
  list: AccountEntry[]
  /** 任一请求失败即标记（结果保留已查得部分） */
  failed: boolean
}

/** 扫描条目中的泄露密码（跳过未设密码条目；逐条带延迟） */
export async function findPwnedEntries(entries: AccountEntry[]): Promise<PwnedScanResult> {
  const list: AccountEntry[] = []
  let failed = false
  for (const entry of entries) {
    if (!entry.password) continue
    try {
      if ((await fetchPwnedCount(entry.password)) > 0) list.push(entry)
    } catch {
      failed = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS))
  }
  return { list, failed }
}
