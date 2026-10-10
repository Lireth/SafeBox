/**
 * 外部链接校验与规范化（O27）
 * IPC openExternal 与窗口 openHandler 共用同一白名单：
 * 仅放行 http/https，防御渲染层被攻破后拉起 file://、ms-settings: 等任意协议。
 */

/**
 * 校验并规范化外部链接，返回可直接交给 shell.openExternal 的 URL。
 * - 空字符串返回 null（调用方静默忽略）
 * - 非字符串 / 格式非法 / 非 http(s) 抛错（错误信息直接透出给渲染端 toast）
 */
export function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') throw new Error('网址格式错误')
  const url = value.trim()
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('网址格式错误')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅允许打开 http/https 链接')
  }
  return parsed.toString()
}
