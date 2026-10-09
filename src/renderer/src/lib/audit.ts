import type { AccountEntry } from '../../../../shared/types'
import { passwordStrength } from './password'

/**
 * 密码安全审计（全程本地计算，零网络请求）
 * - 弱密码：强度评分 ≤ 1（复用 passwordStrength，未设置密码的条目不参与）
 * - 重复密码：SHA-256 分组比对，避免明文驻留内存集合
 * - 久未更新：最后更新时间超过 6 个月
 */

/** 久未更新阈值（毫秒）：约 6 个月 */
export const STALE_THRESHOLD_MS = 6 * 30 * 24 * 60 * 60 * 1000

export interface AuditReport {
  /** 弱密码条目 */
  weak: AccountEntry[]
  /** 重复密码分组（每组 ≥ 2 条） */
  duplicateGroups: AccountEntry[][]
  /** 久未更新条目 */
  stale: AccountEntry[]
  /** 参与扫描的账号总数 */
  scanned: number
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 对全部条目做三维安全扫描 */
export async function auditEntries(entries: AccountEntry[], now = Date.now()): Promise<AuditReport> {
  const withPassword = entries.filter((e) => e.password)

  const weak = withPassword.filter((e) => passwordStrength(e.password).score <= 1)

  const groups = new Map<string, AccountEntry[]>()
  for (const entry of withPassword) {
    const key = await sha256Hex(entry.password)
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }
  const duplicateGroups = [...groups.values()].filter((group) => group.length > 1)

  const stale = entries.filter((e) => now - e.updatedAt >= STALE_THRESHOLD_MS)

  return { weak, duplicateGroups, stale, scanned: entries.length }
}

/** 汇总风险条目数（弱 + 重复涉及 + 久未更新，去重计数） */
export function countRiskyEntries(report: AuditReport): number {
  const ids = new Set<string>()
  for (const e of report.weak) ids.add(e.id)
  for (const group of report.duplicateGroups) for (const e of group) ids.add(e.id)
  for (const e of report.stale) ids.add(e.id)
  return ids.size
}
