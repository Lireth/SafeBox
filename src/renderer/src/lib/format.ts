/**
 * 展示格式化工具（O25 收编）：日期 / 日期时间 / 密码掩码。
 * 此前散落在 EntryRow / EntryDetailModal / AuditModal 重复定义，统一出口避免漂移。
 */

/** 日期（仅日期部分）：安全体检「最后更新」等场景 */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN')
}

/** 日期时间：账号详情「添加于 / 更新于」、历史密码时间等场景 */
export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

/** 密码掩码：圆点重复，最长展示 maxLen 位（不足按实际长度） */
export function maskPassword(password: string, maxLen = 12): string {
  return '•'.repeat(Math.min(password.length, maxLen))
}
